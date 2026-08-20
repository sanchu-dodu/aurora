import {
  createHash,
  randomUUID,
} from "node:crypto";
import fs, {
  type FileHandle,
} from "node:fs/promises";
import type {
  Dirent,
  Stats,
} from "node:fs";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  durableCreateDirectory,
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "./durableFileWriter.js";

import {
  LIFECYCLE_JOURNAL_BLOB_MAX_BYTES,
  LIFECYCLE_JOURNAL_MAX_BYTES,
  LIFECYCLE_JOURNAL_SCHEMA_VERSION,
  assertLifecycleJournalPhaseTransition,
  normalizeLifecycleJournal,
  parseLifecycleJournalEnvelope,
  parseLifecycleJournalRelativePath,
  parseLifecycleSha256,
  parseLifecycleTransactionId,
  serializeLifecycleJournalEnvelope,
  type LifecycleJournal,
  type LifecycleJournalDirectoryBeforeImage,
  type LifecycleJournalFileBeforeImage,
  type LifecycleJournalOperation,
  type LifecycleJournalPhase,
} from "./lifecycleJournalSchema.js";

export const LIFECYCLE_JOURNAL_RELATIVE_ROOT =
  ".aurora/lifecycle-journal";

export const LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT =
  `${LIFECYCLE_JOURNAL_RELATIVE_ROOT}/recovered`;

export interface CreateLifecycleJournalInput {
  readonly transactionId?:
    string;

  readonly operation:
    LifecycleJournalOperation;

  readonly packageIds:
    readonly string[];

  readonly timestamp?:
    string;
}

export class LifecycleJournalStore {
  private readonly pathBoundary:
    ProjectPathBoundary;

  private readonly projectRootSha256:
    string;

  constructor(
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );

    this.projectRootSha256 =
      createHash(
        "sha256"
      )
        .update(
          this.pathBoundary
            .projectRoot,
          "utf8"
        )
        .digest("hex");
  }

  async create(
    input:
      CreateLifecycleJournalInput
  ): Promise<LifecycleJournal> {
    const transactionId =
      parseLifecycleTransactionId(
        input.transactionId ??
        randomUUID()
      );

    const timestamp =
      input.timestamp ??
      new Date().toISOString();

    const journal =
      normalizeLifecycleJournal({
        schemaVersion:
          LIFECYCLE_JOURNAL_SCHEMA_VERSION,

        transactionId,

        projectRootSha256:
          this.projectRootSha256,

        operation:
          input.operation,

        packageIds:
          [...input.packageIds],

        phase:
          "prepared",

        createdAt:
          timestamp,

        updatedAt:
          timestamp,

        files: [],

        directories: [],
      });

    await durableEnsureDirectory(
      this.journalRoot
    );

    await durableCreateDirectory(
      this.transactionDirectory(
        transactionId
      )
    );

    await durableEnsureDirectory(
      this.blobDirectory(
        transactionId
      )
    );

    await this.writeJournal(
      journal
    );

    return journal;
  }

  async read(
    transactionIdInput: string
  ): Promise<LifecycleJournal> {
    const transactionId =
      parseLifecycleTransactionId(
        transactionIdInput
      );

    const snapshot =
      await readStableFile(
        this.journalFile(
          transactionId
        ),
        LIFECYCLE_JOURNAL_MAX_BYTES
      );

    const content =
      snapshot.content;

    let decoded: unknown;

    try {
      decoded =
        JSON.parse(
          content.toString(
            "utf8"
          )
        );
    }
    catch {
      throw new TypeError(
        "Lifecycle journal contains invalid JSON."
      );
    }

    const journal =
      parseLifecycleJournalEnvelope(
        decoded
      );

    if (
      journal.transactionId !==
        transactionId
    ) {
      throw new TypeError(
        "Lifecycle journal transaction id does not match its directory."
      );
    }

    if (
      journal.projectRootSha256 !==
        this.projectRootSha256
    ) {
      throw new TypeError(
        "Lifecycle journal is bound to a different project root."
      );
    }

    for (
      const entry of journal.files
    ) {
      if (entry.kind === "file") {
        await this.readBlob(
          transactionId,
          entry
        );
      }
    }

    return journal;
  }

  async captureFileBeforeImage(
    transactionIdInput: string,
    relativePathInput: string
  ): Promise<
    LifecycleJournalFileBeforeImage
  > {
    const transactionId =
      parseLifecycleTransactionId(
        transactionIdInput
      );

    const relativePath =
      parseLifecycleJournalRelativePath(
        relativePathInput
      );

    const journal =
      await this.read(
        transactionId
      );

    assertCapturePhase(
      journal.phase
    );

    const existing =
      journal.files.find(
        entry =>
          entry.path.toLowerCase() ===
          relativePath.toLowerCase()
      );

    if (existing) {
      return existing;
    }

    const projectFile =
      this.pathBoundary.resolve(
        relativePath
      );

    let entry:
      LifecycleJournalFileBeforeImage;

    let snapshot:
      StableFileSnapshot |
      undefined;

    try {
      snapshot =
        await readStableFile(
          projectFile,
          LIFECYCLE_JOURNAL_BLOB_MAX_BYTES
        );
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw error;
      }
    }

    if (!snapshot) {
      entry = {
        path:
          relativePath,

        kind:
          "absent",
      };
    }
    else {
      const content =
        snapshot.content;

      const sha256 =
        createHash(
          "sha256"
        )
          .update(content)
          .digest("hex");

      entry = {
        path:
          relativePath,

        kind:
          "file",

        sha256,

        size:
          content.length,

        mode:
          snapshot.mode,
      };

      await this.persistBlob(
        transactionId,
        entry,
        content
      );
    }

    const next =
      normalizeLifecycleJournal({
        ...journal,

        updatedAt:
          nextTimestamp(
            journal.updatedAt
          ),

        files: [
          ...journal.files,
          entry,
        ],
      });

    await this.writeJournal(
      next
    );

    return entry;
  }

  async captureDirectoryBeforeImage(
    transactionIdInput: string,
    relativePathInput: string
  ): Promise<
    LifecycleJournalDirectoryBeforeImage
  > {
    const transactionId =
      parseLifecycleTransactionId(
        transactionIdInput
      );

    const relativePath =
      parseLifecycleJournalRelativePath(
        relativePathInput
      );

    const journal =
      await this.read(
        transactionId
      );

    assertCapturePhase(
      journal.phase
    );

    const existing =
      journal.directories.find(
        directory =>
          directory.path.toLowerCase() ===
          relativePath.toLowerCase()
      );

    if (existing) {
      return existing;
    }

    const directory =
      this.pathBoundary.resolve(
        relativePath
      );

    let entry:
      LifecycleJournalDirectoryBeforeImage;

    try {
      const information =
        await fs.lstat(
          directory
        );

      if (
        information.isSymbolicLink() ||
        !information.isDirectory()
      ) {
        throw new Error(
          `Lifecycle journal path is not a regular directory: ${relativePath}`
        );
      }

      entry = {
        path:
          relativePath,

        kind:
          "directory",

        mode:
          information.mode &
          0o777,
      };
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw error;
      }

      entry = {
        path:
          relativePath,

        kind:
          "absent",
      };
    }

    const next =
      normalizeLifecycleJournal({
        ...journal,

        updatedAt:
          nextTimestamp(
            journal.updatedAt
          ),

        directories: [
          ...journal.directories,
          entry,
        ],
      });

    await this.writeJournal(
      next
    );

    return entry;
  }

  async transition(
    transactionIdInput: string,
    nextPhase:
      LifecycleJournalPhase
  ): Promise<LifecycleJournal> {
    const transactionId =
      parseLifecycleTransactionId(
        transactionIdInput
      );

    const journal =
      await this.read(
        transactionId
      );

    assertLifecycleJournalPhaseTransition(
      journal.phase,
      nextPhase
    );

    if (
      journal.phase ===
        nextPhase
    ) {
      return journal;
    }

    const next =
      normalizeLifecycleJournal({
        ...journal,

        phase:
          nextPhase,

        updatedAt:
          nextTimestamp(
            journal.updatedAt
          ),
      });

    await this.writeJournal(
      next
    );

    return next;
  }

  async readBeforeImage(
    transactionIdInput: string,
    relativePathInput: string
  ): Promise<Buffer | null> {
    const transactionId =
      parseLifecycleTransactionId(
        transactionIdInput
      );

    const relativePath =
      parseLifecycleJournalRelativePath(
        relativePathInput
      );

    const journal =
      await this.read(
        transactionId
      );

    const entry =
      journal.files.find(
        candidate =>
          candidate.path.toLowerCase() ===
          relativePath.toLowerCase()
      );

    if (!entry) {
      throw new Error(
        `Lifecycle journal has no before-image for '${relativePath}'.`
      );
    }

    if (entry.kind === "absent") {
      return null;
    }

    return this.readBlob(
      transactionId,
      entry
    );
  }

  async listIncomplete(): Promise<
    LifecycleJournal[]
  > {
    let entries:
      Dirent[];

    try {
      entries =
        await fs.readdir(
          this.journalRoot,
          {
            withFileTypes: true,
          }
        );
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code === "ENOENT") {
        return [];
      }

      throw error;
    }

    const journals:
      LifecycleJournal[] = [];

    for (
      const entry of entries
        .sort(
          (left, right) =>
            compareText(
              left.name,
              right.name
            )
        )
    ) {
      if (!entry.isDirectory()) {
        throw new TypeError(
          `Unexpected lifecycle journal entry '${entry.name}'.`
        );
      }

      if (
        entry.name ===
          "recovered"
      ) {
        continue;
      }

      const transactionId =
        parseLifecycleTransactionId(
          entry.name
        );

      const journal =
        await this.read(
          transactionId
        );

      if (
        journal.phase !==
          "committed"
      ) {
        journals.push(
          journal
        );
      }
    }

    return journals;
  }

  async archiveRecovered(
    transactionIdInput: string
  ): Promise<void> {
    const transactionId =
      parseLifecycleTransactionId(
        transactionIdInput
      );

    const journal =
      await this.read(
        transactionId
      );

    if (
      journal.phase ===
        "committed"
    ) {
      throw new Error(
        `Cannot archive committed lifecycle transaction '${transactionId}' as recovered.`
      );
    }

    await durableEnsureDirectory(
      this.recoveredRoot
    );

    const source =
      this.transactionDirectory(
        transactionId
      );

    const destination =
      this.recoveredTransactionDirectory(
        transactionId
      );

    try {
      await fs.lstat(
        destination
      );

      throw new Error(
        `Recovered lifecycle transaction archive '${transactionId}' already exists.`
      );
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw error;
      }
    }

    await fs.rename(
      source,
      destination
    );

    await syncDirectory(
      this.journalRoot
    );

    await syncDirectory(
      this.recoveredRoot
    );
  }

  private get journalRoot(): string {
    return this.pathBoundary.resolve(
      LIFECYCLE_JOURNAL_RELATIVE_ROOT
    );
  }

  private get recoveredRoot(): string {
    return this.pathBoundary.resolve(
      LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT
    );
  }

  private transactionDirectory(
    transactionId: string
  ): string {
    return this.pathBoundary.resolve(
      `${LIFECYCLE_JOURNAL_RELATIVE_ROOT}/${transactionId}`
    );
  }

  private blobDirectory(
    transactionId: string
  ): string {
    return this.pathBoundary.resolve(
      `${LIFECYCLE_JOURNAL_RELATIVE_ROOT}/${transactionId}/blobs`
    );
  }

  private recoveredTransactionDirectory(
    transactionId: string
  ): string {
    return this.pathBoundary.resolve(
      `${LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT}/${transactionId}`
    );
  }

  private journalFile(
    transactionId: string
  ): string {
    return this.pathBoundary.resolve(
      `${LIFECYCLE_JOURNAL_RELATIVE_ROOT}/${transactionId}/journal.json`
    );
  }

  private blobFile(
    transactionId: string,
    sha256Input: string
  ): string {
    const sha256 =
      parseLifecycleSha256(
        sha256Input
      );

    return this.pathBoundary.resolve(
      `${LIFECYCLE_JOURNAL_RELATIVE_ROOT}/${transactionId}/blobs/${sha256}.bin`
    );
  }

  private async writeJournal(
    journalInput: unknown
  ): Promise<void> {
    const journal =
      normalizeLifecycleJournal(
        journalInput
      );

    if (
      journal.projectRootSha256 !==
        this.projectRootSha256
    ) {
      throw new TypeError(
        "Refusing to persist a lifecycle journal bound to a different project root."
      );
    }

    const serialized =
      serializeLifecycleJournalEnvelope(
        journal
      );

    if (
      Buffer.byteLength(
        serialized,
        "utf8"
      ) >
      LIFECYCLE_JOURNAL_MAX_BYTES
    ) {
      throw new TypeError(
        "Lifecycle journal exceeds the maximum supported size."
      );
    }

    await durableWriteFile(
      this.journalFile(
        journal.transactionId
      ),
      serialized,
      {
        mode:
          0o600,
      }
    );
  }

  private async persistBlob(
    transactionId: string,
    entry:
      Extract<
        LifecycleJournalFileBeforeImage,
        {
          kind: "file";
        }
      >,
    content: Buffer
  ): Promise<void> {
    const blobFile =
      this.blobFile(
        transactionId,
        entry.sha256
      );

    try {
      const existing =
        await readStableFile(
          blobFile,
          LIFECYCLE_JOURNAL_BLOB_MAX_BYTES
        );

      assertBlobMatches(
        entry,
        existing.content
      );

      return;
    }
    catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw error;
      }
    }

    await durableWriteFile(
      blobFile,
      content,
      {
        mode:
          0o600,
      }
    );

    const persisted =
      await readStableFile(
        blobFile,
        LIFECYCLE_JOURNAL_BLOB_MAX_BYTES
      );

    assertBlobMatches(
      entry,
      persisted.content
    );
  }

  private async readBlob(
    transactionId: string,
    entry:
      Extract<
        LifecycleJournalFileBeforeImage,
        {
          kind: "file";
        }
      >
  ): Promise<Buffer> {
    const snapshot =
      await readStableFile(
        this.blobFile(
          transactionId,
          entry.sha256
        ),
        LIFECYCLE_JOURNAL_BLOB_MAX_BYTES
      );

    assertBlobMatches(
      entry,
      snapshot.content
    );

    return snapshot.content;
  }
}

interface StableFileSnapshot {
  readonly content: Buffer;
  readonly mode: number;
}

async function readStableFile(
  file: string,
  maximumBytes: number
): Promise<StableFileSnapshot> {
  let handle:
    FileHandle | undefined;

  try {
    handle =
      await fs.open(
        file,
        "r"
      );

    const information =
      await handle.stat();

    const pathInformation =
      await fs.lstat(
        file
      );

    if (
      !information.isFile() ||
      pathInformation.isSymbolicLink() ||
      !pathInformation.isFile() ||
      !sameFileIdentity(
        information,
        pathInformation
      )
    ) {
      throw new Error(
        `Lifecycle journal path is not a stable regular file: ${file}`
      );
    }

    if (
      information.size >
        maximumBytes
    ) {
      throw new TypeError(
        `Lifecycle journal file exceeds its maximum supported size: ${file}`
      );
    }

    const content =
      await handle.readFile();

    const completedInformation =
      await handle.stat();

    const completedPathInformation =
      await fs.lstat(
        file
      );

    if (
      fileChangedWhileReading(
        information,
        completedInformation
      ) ||
      content.length !==
        information.size ||
      completedPathInformation
        .isSymbolicLink() ||
      !completedPathInformation
        .isFile() ||
      !sameFileIdentity(
        completedInformation,
        completedPathInformation
      )
    ) {
      throw new Error(
        `Lifecycle journal file changed while being read: ${file}`
      );
    }

    return {
      content,
      mode:
        information.mode &
        0o777,
    };
  }
  catch (error) {
    const code =
      (
        error as NodeJS.ErrnoException
      ).code;

    if (
      handle !== undefined &&
      code === "ENOENT"
    ) {
      throw new Error(
        `Lifecycle journal file changed while being read: ${file}`,
        {
          cause:
            error,
        }
      );
    }

    throw error;
  }
  finally {
    await handle?.close();
  }
}

function assertBlobMatches(
  entry:
    Extract<
      LifecycleJournalFileBeforeImage,
      {
        kind: "file";
      }
    >,
  content: Buffer
): void {
  if (
    content.length !==
      entry.size
  ) {
    throw new TypeError(
      `Lifecycle journal before-image size verification failed for '${entry.path}'.`
    );
  }

  const digest =
    createHash(
      "sha256"
    )
      .update(content)
      .digest("hex");

  if (
    digest !==
      entry.sha256
  ) {
    throw new TypeError(
      `Lifecycle journal before-image digest verification failed for '${entry.path}'.`
    );
  }
}

function assertCapturePhase(
  phase:
    LifecycleJournalPhase
): void {
  if (
    phase !== "prepared" &&
    phase !== "mutating"
  ) {
    throw new Error(
      `Lifecycle journal cannot capture new rollback state during phase '${phase}'.`
    );
  }
}

function nextTimestamp(
  previous: string
): string {
  const now =
    new Date();

  const previousTime =
    new Date(
      previous
    ).getTime();

  if (
    now.getTime() <=
      previousTime
  ) {
    return new Date(
      previousTime + 1
    ).toISOString();
  }

  return now.toISOString();
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function fileChangedWhileReading(
  before: Stats,
  after: Stats
): boolean {
  return (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  );
}

function compareText(
  left: string,
  right: string
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
