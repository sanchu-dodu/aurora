import fs from "node:fs/promises";
import type {
  Stats,
} from "node:fs";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "./durableFileWriter.js";

import type {
  LifecycleJournal,
  LifecycleJournalDirectoryBeforeImage,
  LifecycleJournalFileBeforeImage,
} from "./lifecycleJournalSchema.js";

import {
  LifecycleJournalStore,
} from "./lifecycleJournalStore.js";

import {
  ProjectLifecycleLock,
} from "./projectLifecycleLock.js";


export class LifecycleRecoveryManager {
  private readonly pathBoundary:
    ProjectPathBoundary;

  private readonly journalStore:
    LifecycleJournalStore;


  constructor(
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );

    this.journalStore =
      new LifecycleJournalStore(
        this.pathBoundary
          .projectRoot
      );
  }


  async recoverIncomplete(
    lifecycleLock:
      ProjectLifecycleLock |
      undefined
  ): Promise<
    readonly LifecycleJournal[]
  > {
    await this.assertRecoveryAuthority(
      lifecycleLock
    );

    /*
     * listIncomplete() validates every journal envelope and
     * every referenced before-image blob before recovery is
     * allowed to mutate the project.
     */
    const journals =
      [
        ...await this.journalStore
          .listIncomplete(),
      ]
        .sort(
          compareJournalsNewestFirst
        );

    for (const journal of journals) {
      validateRecoveryPlan(
        journal
      );
    }

    const recovered:
      LifecycleJournal[] = [];

    for (const journal of journals) {
      await this.restoreJournal(
        journal
      );

      /*
       * Moving the complete transaction directory is the
       * durable terminal action. A crash before the rename
       * leaves the journal discoverable and safe to replay;
       * a crash after it prevents later recovery runs from
       * undoing legitimate work performed after recovery.
       */
      await this.journalStore
        .archiveRecovered(
          journal.transactionId
        );

      recovered.push(
        journal
      );
    }

    return recovered;
  }


  private async assertRecoveryAuthority(
    lifecycleLock:
      ProjectLifecycleLock |
      undefined
  ): Promise<void> {
    if (
      !(
        lifecycleLock instanceof
          ProjectLifecycleLock
      ) ||
      !lifecycleLock.isHeld
    ) {
      throw new Error(
        "Lifecycle recovery requires a held project lifecycle lock."
      );
    }

    if (
      lifecycleLock.projectRoot !==
        this.pathBoundary
          .projectRoot
    ) {
      throw new Error(
        "Lifecycle recovery lock belongs to a different project root."
      );
    }

    const owner =
      await lifecycleLock
        .readOwner();

    if (
      owner.token !==
        lifecycleLock.ownerToken
    ) {
      throw new Error(
        "Lifecycle recovery lock ownership changed before recovery began."
      );
    }
  }


  private async restoreJournal(
    journal: LifecycleJournal
  ): Promise<void> {
    const directoryPaths =
      new Set(
        journal.directories.map(
          entry =>
            entry.path
              .toLowerCase()
        )
      );

    const filePaths =
      new Set(
        journal.files.map(
          entry =>
            entry.path
              .toLowerCase()
        )
      );

    const absentFiles =
      journal.files
        .filter(
          (
            entry
          ): entry is Extract<
            LifecycleJournalFileBeforeImage,
            {
              kind: "absent";
            }
          > =>
            entry.kind ===
              "absent"
        )
        .sort(
          comparePathsDeepestFirst
        );

    for (const entry of absentFiles) {
      await this.removeAbsentFile(
        entry.path,
        directoryPaths.has(
          entry.path
            .toLowerCase()
        )
      );
    }

    const absentDirectories =
      journal.directories
        .filter(
          (
            entry
          ): entry is Extract<
            LifecycleJournalDirectoryBeforeImage,
            {
              kind: "absent";
            }
          > =>
            entry.kind ===
              "absent"
        )
        .sort(
          comparePathsDeepestFirst
        );

    for (
      const entry of
      absentDirectories
    ) {
      await this.removeAbsentDirectory(
        entry.path,
        filePaths.has(
          entry.path
            .toLowerCase()
        )
      );
    }

    const originalDirectories =
      journal.directories
        .filter(
          (
            entry
          ): entry is Extract<
            LifecycleJournalDirectoryBeforeImage,
            {
              kind: "directory";
            }
          > =>
            entry.kind ===
              "directory"
        )
        .sort(
          comparePathsShallowestFirst
        );

    for (
      const entry of
      originalDirectories
    ) {
      await this.ensureOriginalDirectory(
        entry
      );
    }

    const originalFiles =
      journal.files
        .filter(
          (
            entry
          ): entry is Extract<
            LifecycleJournalFileBeforeImage,
            {
              kind: "file";
            }
          > =>
            entry.kind ===
              "file"
        )
        .sort(
          comparePathsShallowestFirst
        );

    for (const entry of originalFiles) {
      await this.restoreFile(
        journal.transactionId,
        entry
      );
    }

    /*
     * Restore directory permissions only after child files
     * have been recreated. A restrictive original mode must
     * not prevent its own recovery from completing.
     */
    for (
      const entry of
      [...originalDirectories]
        .sort(
          comparePathsDeepestFirst
        )
    ) {
      await this.restoreDirectoryMode(
        entry
      );
    }
  }


  private async removeAbsentFile(
    relativePath: string,
    hasDirectoryEvidence:
      boolean
  ): Promise<void> {
    const target =
      this.pathBoundary.resolve(
        relativePath
      );

    let information:
      Stats;

    try {
      information =
        await fs.lstat(
          target
        );
    }
    catch (error) {
      if (isErrno(error, "ENOENT")) {
        return;
      }

      throw error;
    }

    if (
      information.isSymbolicLink()
    ) {
      throw unsafeRecoveryType(
        relativePath,
        "symbolic link"
      );
    }

    if (information.isDirectory()) {
      if (hasDirectoryEvidence) {
        return;
      }

      throw unsafeRecoveryType(
        relativePath,
        "directory"
      );
    }

    if (!information.isFile()) {
      throw unsafeRecoveryType(
        relativePath,
        "non-regular file"
      );
    }

    await fs.unlink(
      target
    );

    await syncDirectory(
      path.dirname(target)
    );
  }


  private async removeAbsentDirectory(
    relativePath: string,
    hasFileEvidence:
      boolean
  ): Promise<void> {
    const target =
      this.pathBoundary.resolve(
        relativePath
      );

    let information:
      Stats;

    try {
      information =
        await fs.lstat(
          target
        );
    }
    catch (error) {
      if (isErrno(error, "ENOENT")) {
        return;
      }

      throw error;
    }

    if (
      information.isSymbolicLink()
    ) {
      throw unsafeRecoveryType(
        relativePath,
        "symbolic link"
      );
    }

    if (information.isFile()) {
      if (hasFileEvidence) {
        return;
      }

      throw unsafeRecoveryType(
        relativePath,
        "regular file"
      );
    }

    if (!information.isDirectory()) {
      throw unsafeRecoveryType(
        relativePath,
        "non-directory"
      );
    }

    try {
      await fs.rmdir(
        target
      );
    }
    catch (error) {
      if (isErrno(error, "ENOENT")) {
        return;
      }

      if (
        isErrno(error, "ENOTEMPTY") ||
        isErrno(error, "EEXIST")
      ) {
        throw new Error(
          `Lifecycle recovery refused to remove non-empty directory '${relativePath}'.`,
          {
            cause:
              error,
          }
        );
      }

      throw error;
    }

    await syncDirectory(
      path.dirname(target)
    );
  }


  private async ensureOriginalDirectory(
    entry:
      Extract<
        LifecycleJournalDirectoryBeforeImage,
        {
          kind: "directory";
        }
      >
  ): Promise<void> {
    const target =
      this.pathBoundary.resolve(
        entry.path
      );

    try {
      const information =
        await fs.lstat(
          target
        );

      if (
        information
          .isSymbolicLink() ||
        !information
          .isDirectory()
      ) {
        throw unsafeRecoveryType(
          entry.path,
          "non-directory"
        );
      }
    }
    catch (error) {
      if (!isErrno(error, "ENOENT")) {
        throw error;
      }

      await durableEnsureDirectory(
        target
      );
    }
  }


  private async restoreFile(
    transactionId: string,
    entry:
      Extract<
        LifecycleJournalFileBeforeImage,
        {
          kind: "file";
        }
      >
  ): Promise<void> {
    const target =
      this.pathBoundary.resolve(
        entry.path
      );

    try {
      const information =
        await fs.lstat(
          target
        );

      if (
        information
          .isSymbolicLink() ||
        !information.isFile()
      ) {
        throw unsafeRecoveryType(
          entry.path,
          "non-regular file"
        );
      }
    }
    catch (error) {
      if (!isErrno(error, "ENOENT")) {
        throw error;
      }
    }

    const content =
      await this.journalStore
        .readBeforeImage(
          transactionId,
          entry.path
        );

    if (content === null) {
      throw new TypeError(
        `Lifecycle recovery expected a file before-image for '${entry.path}'.`
      );
    }

    await durableWriteFile(
      target,
      content,
      {
        mode:
          entry.mode,
      }
    );

    await syncFileMode(
      target,
      entry.mode
    );
  }


  private async restoreDirectoryMode(
    entry:
      Extract<
        LifecycleJournalDirectoryBeforeImage,
        {
          kind: "directory";
        }
      >
  ): Promise<void> {
    const target =
      this.pathBoundary.resolve(
        entry.path
      );

    const information =
      await fs.lstat(
        target
      );

    if (
      information.isSymbolicLink() ||
      !information.isDirectory()
    ) {
      throw unsafeRecoveryType(
        entry.path,
        "non-directory"
      );
    }

    await fs.chmod(
      target,
      entry.mode
    );

    await syncDirectory(
      target
    );
  }
}


function validateRecoveryPlan(
  journal: LifecycleJournal
): void {
  const files =
    new Map(
      journal.files.map(
        entry => [
          entry.path
            .toLowerCase(),
          entry,
        ] as const
      )
    );

  const directories =
    new Map(
      journal.directories.map(
        entry => [
          entry.path
            .toLowerCase(),
          entry,
        ] as const
      )
    );

  for (
    const [relativePath, file]
    of files
  ) {
    const directory =
      directories.get(
        relativePath
      );

    if (
      directory &&
      file.kind !== "absent" &&
      directory.kind !== "absent"
    ) {
      throw new TypeError(
        `Lifecycle recovery plan records '${file.path}' as both a file and a directory.`
      );
    }
  }

  const existingFiles =
    journal.files.filter(
      entry =>
        entry.kind === "file"
    );

  const resourcePaths =
    new Set([
      ...files.keys(),
      ...directories.keys(),
    ]);

  for (const file of existingFiles) {
    const prefix =
      `${file.path.toLowerCase()}/`;

    if (
      [...resourcePaths].some(
        candidate =>
          candidate.startsWith(
            prefix
          )
      )
    ) {
      throw new TypeError(
        `Lifecycle recovery plan places a child beneath file '${file.path}'.`
      );
    }
  }
}


async function syncFileMode(
  file: string,
  mode: number
): Promise<void> {
  let handle:
    fs.FileHandle | undefined;

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
      pathInformation
        .isSymbolicLink() ||
      !pathInformation.isFile() ||
      !sameFileIdentity(
        information,
        pathInformation
      )
    ) {
      throw new Error(
        `Lifecycle recovery path is not a stable regular file: ${file}`
      );
    }

    await handle.chmod(
      mode
    );

    /*
     * Windows rejects fsync on this read-only handle after
     * chmod. durableWriteFile() already synced the complete
     * file before rename; retain the additional metadata sync
     * on platforms that support it.
     */
    if (process.platform !== "win32") {
      await handle.sync();
    }
  }
  finally {
    await handle?.close();
  }
}


function compareJournalsNewestFirst(
  left: LifecycleJournal,
  right: LifecycleJournal
): number {
  const timestampOrder =
    compareText(
      right.createdAt,
      left.createdAt
    );

  if (timestampOrder !== 0) {
    return timestampOrder;
  }

  return compareText(
    right.transactionId,
    left.transactionId
  );
}


function comparePathsDeepestFirst(
  left: {
    readonly path: string;
  },
  right: {
    readonly path: string;
  }
): number {
  const depthOrder =
    pathDepth(right.path) -
    pathDepth(left.path);

  if (depthOrder !== 0) {
    return depthOrder;
  }

  return compareText(
    right.path,
    left.path
  );
}


function comparePathsShallowestFirst(
  left: {
    readonly path: string;
  },
  right: {
    readonly path: string;
  }
): number {
  const depthOrder =
    pathDepth(left.path) -
    pathDepth(right.path);

  if (depthOrder !== 0) {
    return depthOrder;
  }

  return compareText(
    left.path,
    right.path
  );
}


function pathDepth(
  relativePath: string
): number {
  return relativePath
    .split("/")
    .length;
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


function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}


function isErrno(
  error: unknown,
  code: string
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (
      error as
        NodeJS.ErrnoException
    ).code === code
  );
}


function unsafeRecoveryType(
  relativePath: string,
  actualType: string
): Error {
  return new Error(
    `Lifecycle recovery path '${relativePath}' has unsafe type '${actualType}'.`
  );
}
