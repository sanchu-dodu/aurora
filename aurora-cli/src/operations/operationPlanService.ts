import {
  createHash,
  randomUUID,
} from "node:crypto";

import type {
  Dir,
  Dirent,
  Stats,
} from "node:fs";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import { DurableOperationTransaction } from "./durableOperationTransaction.js";
import { assertOperationPlanAncestorCasing, isOperationErrno } from "./operationJournal.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

import {
  LIFECYCLE_JOURNAL_MAX_BYTES,
  parseLifecycleJournalEnvelope,
  parseLifecycleTransactionId,
} from "../packages/lifecycle/lifecycleJournalSchema.js";

import {
  ProjectLifecycleLock,
} from "../packages/lifecycle/projectLifecycleLock.js";

import {
  parsePackageManifestBytes,
} from "../packages/trust/packageManifestJson.js";

import {
  MAX_PLAN_FILE_BYTES,
  normalizePlanPath,
  parseOperationPlan,
  type ExpectedFileState,
  type FileWriteOperation,
  type OperationPlan,
  type PlanOperation,
} from "./operationPlan.js";

import {
  createOperationReport,
  type OperationReport,
} from "./operationReport.js";

const DEFAULT_PLAN_LIFETIME_MS =
  15 * 60 * 1000;

const MAX_LIFECYCLE_JOURNALS = 128;

const SUPPORTED_OPERATION_KINDS =
  new Set<PlanOperation["kind"]>([
    "file.write",
  ]);

interface PreparedFileWrite {
  readonly operation: FileWriteOperation;
  readonly target: string;
}

export interface PlanClock {
  now(): number;
}

export interface FileWritePlanFileOptions {
  readonly relativePath: string;

  readonly content: string;

  readonly description?: string;

  readonly mode?: number;

  readonly directoryMode?: number;
}

export interface CreateFileWriteBatchPlanOptions {
  readonly projectRoot: string;

  readonly files: readonly FileWritePlanFileOptions[];

  readonly summary: string;

  readonly intent: string;

  readonly lifetimeMs?: number;
}

export interface CreateFileWritePlanOptions
  extends FileWritePlanFileOptions {
  readonly projectRoot: string;

  readonly summary: string;

  readonly intent: string;

  readonly lifetimeMs?: number;
}

export interface ApplyOperationPlanOptions {
  readonly approved: boolean;

  readonly dryRun?: boolean;
}

export class OperationPlanService {
  private readonly now:
    () => number;

  constructor(
    clock: PlanClock = {
      now: Date.now,
    }
  ) {
    this.now = () =>
      clock.now();
  }

  async createFileWritePlan(
    options:
      CreateFileWritePlanOptions
  ): Promise<OperationPlan> {
    return this.createFileWriteBatchPlan({
      projectRoot: options.projectRoot,
      files: [options],
      summary: options.summary,
      intent: options.intent,
      ...(options.lifetimeMs === undefined
        ? {}
        : { lifetimeMs: options.lifetimeMs }),
    });
  }

  async createFileWriteBatchPlan(
    options: CreateFileWriteBatchPlanOptions
  ): Promise<OperationPlan> {
    const boundary =
      new ProjectPathBoundary(
        options.projectRoot
      );

    const now = this.now();
    const lifetimeMs =
      options.lifetimeMs ??
      DEFAULT_PLAN_LIFETIME_MS;

    if (
      !Number.isSafeInteger(
        lifetimeMs
      ) ||
      lifetimeMs <= 0 ||
      lifetimeMs >
        24 * 60 * 60 * 1000
    ) {
      throw operationPlanError(
        "Plan lifetime must be between 1 millisecond and 24 hours."
      );
    }

    const operations: FileWriteOperation[] =
      options.files.map((file, index) => {
        const relativePath = normalizePlanPath(file.relativePath);
        return {
          id: `op-${String(index + 1).padStart(3, "0")}`,
          kind: "file.write",
          risk: "low",
          description:
            file.description ??
            `Write ${relativePath}`,
          path: relativePath,
          content: file.content,
          contentSha256:
            sha256(file.content),
          expected: { exists: false },
          ...(file.mode === undefined
            ? {}
            : {
                mode: file.mode,
              }),
          ...(file.directoryMode ===
            undefined
            ? {}
            : {
                directoryMode:
                  file.directoryMode,
              }),
        };
      });

    // Reject duplicate, overlapping, oversized, or invalid writes before inspecting files.
    const plan = parseBoundedPlan({
      schemaVersion: 1,
      id:
        `plan-${randomUUID()}`,
      createdAt:
        new Date(now)
          .toISOString(),
      expiresAt:
        new Date(
          now + lifetimeMs
        ).toISOString(),
      projectFingerprint:
        createProjectFingerprint(
          boundary.projectRoot
        ),
      intent: options.intent,
      summary: options.summary,
      requiresApproval: true,
      operations,
    });

    assertOperationPlanAncestorCasing(plan);

    const prepared: FileWriteOperation[] = [];
    for (const operation of plan.operations) {
      if (operation.kind !== "file.write") continue;
      prepared.push({
        ...operation,
        expected: await readFileState(boundary.resolve(operation.path)),
      });
    }

    return parseBoundedPlan({ ...plan, operations: prepared });
  }

  async readPlanFile(
    planFile: string
  ): Promise<OperationPlan> {
    const absolutePlanFile =
      path.resolve(planFile);

    let handle:
      fs.FileHandle | undefined;
    let raw: string;

    try {
      handle = await fs.open(
        absolutePlanFile,
        "r"
      );

      const openedInformation =
        await handle.stat();
      const pathInformation =
        await fs.lstat(
          absolutePlanFile
        );

      if (
        !openedInformation.isFile() ||
        !pathInformation.isFile() ||
        pathInformation
          .isSymbolicLink() ||
        openedInformation.size >
          MAX_PLAN_FILE_BYTES ||
        !sameFileIdentity(
          openedInformation,
          pathInformation
        )
      ) {
        throw operationPlanError(
          "Operation plan must remain a regular JSON file no larger than 1 MiB while it is being opened."
        );
      }

      raw = await handle.readFile({
        encoding: "utf8",
      });

      const completedInformation =
        await handle.stat();

      if (
        fileChangedWhileReading(
          openedInformation,
          completedInformation
        )
      ) {
        throw operationPlanError(
          "Operation plan file changed while it was being read."
        );
      }
    } catch (error) {
      if (
        error instanceof AuroraError
      ) {
        throw error;
      }

      throw operationPlanError(
        "Operation plan file could not be read safely.",
        error
      );
    } finally {
      await handle?.close();
    }

    let value: unknown;

    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw operationPlanError(
        "Operation plan file is not valid JSON.",
        error
      );
    }

    return parseOperationPlan(
      value,
      absolutePlanFile
    );
  }

  async writePlanFile(
    plan: OperationPlan,
    planFile: string
  ): Promise<string> {
    const validated =
      parseOperationPlan(plan);

    assertOperationPlanAncestorCasing(validated);

    const absolutePlanFile =
      path.resolve(planFile);

    const directory =
      path.dirname(
        absolutePlanFile
      );

    let directoryInformation;

    try {
      directoryInformation =
        await fs.lstat(directory);
    } catch (error) {
      throw operationPlanError(
        "Operation plan output directory could not be inspected.",
        error
      );
    }

    if (
      !directoryInformation
        .isDirectory() ||
      directoryInformation
        .isSymbolicLink()
    ) {
      throw operationPlanError(
        "Operation plan output directory must be a regular directory."
      );
    }

    try {
      const existing =
        await fs.lstat(
          absolutePlanFile
        );

      if (
        existing.isSymbolicLink() ||
        !existing.isFile()
      ) {
        throw operationPlanError(
          "Operation plan output must be a regular file."
        );
      }
    } catch (error) {
      if (
        error instanceof AuroraError
      ) {
        throw error;
      }

      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw operationPlanError(
          "Operation plan output could not be validated.",
          error
        );
      }
    }

    const content =
      `${JSON.stringify(
        validated,
        null,
        2
      )}\n`;

    let handle;

    try {
      handle = await fs.open(
        absolutePlanFile,
        "wx",
        0o600
      );

      await handle.writeFile(
        content,
        "utf8"
      );

      await handle.sync();
      await handle.chmod(0o600);
    } catch (error) {
      throw operationPlanError(
        "Operation plan output could not be created without overwriting an existing file.",
        error
      );
    } finally {
      await handle?.close();
    }

    return absolutePlanFile;
  }

  async apply(
    plan: OperationPlan,
    projectRoot: string,
    options:
      ApplyOperationPlanOptions
  ): Promise<OperationReport> {
    const validated =
      parseOperationPlan(plan);

    assertOperationPlanAncestorCasing(validated);

    const startedAt =
      new Date(this.now())
        .toISOString();

    if (
      !options.approved &&
      !options.dryRun
    ) {
      throw new AuroraError(
        "Operation plan approval is required before mutation.",
        {
          code:
            ErrorCodes
              .OPERATION_APPROVAL_REQUIRED,
          suggestion:
            "Inspect the plan, then rerun with explicit approval.",
        }
      );
    }

    const boundary =
      new ProjectPathBoundary(
        projectRoot
      );

    if (
      validated.projectFingerprint !==
      createProjectFingerprint(
        boundary.projectRoot
      )
    ) {
      throw operationPlanError(
        "Operation plan belongs to a different project root."
      );
    }

    assertPlanNotExpired(validated, this.now());

    const directoryModes = new Map<string, number>();

    for (
      const operation
      of validated.operations
    ) {
      if (
        !SUPPORTED_OPERATION_KINDS
          .has(operation.kind)
      ) {
        throw operationPlanError(
          `Operation kind '${operation.kind}' does not have an enabled executor.`
        );
      }

      if (operation.kind === "file.write") {
        if (sha256(operation.content) !== operation.contentSha256) {
          throw operationPlanError(
            `Operation '${operation.id}' content digest does not match its plan.`
          );
        }
        assertNotLifecycleAuthorityPath(operation.path);
        if ((operation.mode !== undefined && (operation.mode & 0o400) === 0) ||
            (operation.directoryMode !== undefined && (operation.directoryMode & 0o700) !== 0o700)) {
          throw operationPlanError("File writes must retain owner read permission and directories must retain owner read/write/search permissions.");
        }
        if (operation.directoryMode !== undefined) {
          const key = path.posix.dirname(operation.path).toLowerCase();
          const previous = directoryModes.get(key);
          if (previous !== undefined && previous !== operation.directoryMode) {
            throw operationPlanError("File writes cannot request conflicting modes for a shared parent directory.");
          }
          directoryModes.set(key, operation.directoryMode);
        }
      }
    }

    // Preview never acquires a lock or creates lifecycle metadata.
    if (options.dryRun) {
      await this.preflightFileWrites(validated, boundary);
      return createOperationReport(
        validated,
        "dry-run",
        startedAt,
        new Date(this.now()).toISOString()
      );
    }

    // Package lifecycle mutations and operation plans share one authority.
    // In particular, rollback must finish before another writer can capture
    // its before-images, otherwise a losing plan could remove a winner's file.
    const lifecycleLock = await ProjectLifecycleLock
      .acquire(boundary.projectRoot)
      .catch(error => {
        throw operationPlanError(
          "Operation plan could not acquire the project lifecycle lock.", error
        );
      });

    let failed = false;
    let failure: unknown;
    try {
      assertPlanNotExpired(validated, this.now());

      try {
        await assertLifecycleJournalsCommitted(boundary);
      } catch (error) {
        throw operationPlanError(
          "Operation plan is blocked by incomplete or invalid lifecycle recovery metadata. Inspect and recover the package lifecycle before retrying.",
          error
        );
      }

      await this.preflightFileWrites(validated, boundary);
      await this.writePreparedPlan(validated, boundary, lifecycleLock);
      return createOperationReport(
        validated,
        "applied",
        startedAt,
        new Date(this.now()).toISOString()
      );
    } catch (error) {
      failed = true;
      failure = error;
      throw error;
    } finally {
      try {
        await lifecycleLock.release();
      } catch (error) {
        throw operationPlanError(
          "Operation plan could not release its lifecycle lock. Inspect the project lifecycle lock before retrying.",
          failed ? new AggregateError([failure, error]) : error
        );
      }
    }
  }

  private async preflightFileWrites(
    validated: OperationPlan,
    boundary: ProjectPathBoundary
  ): Promise<PreparedFileWrite[]> {
    const prepared: PreparedFileWrite[] = [];

    for (
      const operation
      of validated.operations
    ) {
      if (
        operation.kind !==
          "file.write"
      ) {
        continue;
      }

      const target =
        boundary.resolve(
          operation.path
        );

      const actual =
        await readFileState(
          target
        );

      // Preview and apply reject permission settings that would make durable
      // verification or rollback inaccessible, without creating journal state.
      if (actual.exists) {
        const information = await fs.lstat(target, { bigint: true });
        if ((information.mode & 0o400n) === 0n) {
          throw operationPlanError("A file target must retain owner read permission for safe recovery.");
        }
      } else if (operation.mode === undefined && ((0o666 & ~process.umask()) & 0o400) === 0) {
        throw operationPlanError("The current creation mask would make file recovery inaccessible.");
      }
      let parent = path.dirname(target);
      while (true) {
        let information;
        try { information = await fs.lstat(parent, { bigint: true }); }
        catch (error) {
          if (!isOperationErrno(error, "ENOENT")) throw error;
        }
        if (information) {
          const requiredOwnerMode = process.platform === "win32" ? 0o600n : 0o700n;
          if (!information.isDirectory() || information.isSymbolicLink() ||
              (information.mode & requiredOwnerMode) !== requiredOwnerMode) {
            throw operationPlanError("A target parent must retain owner read/write/search permissions for safe recovery.");
          }
          break;
        }
        if (((0o777 & ~process.umask()) & 0o700) !== 0o700) {
          throw operationPlanError("The current creation mask would make directory recovery inaccessible.");
        }
        if (parent === boundary.projectRoot) throw operationPlanError("The project root disappeared during validation.");
        parent = path.dirname(parent);
      }

      if (
        !fileStatesEqual(
          operation.expected,
          actual
        )
      ) {
        throw new AuroraError(
          `Project state changed after plan creation at '${operation.path}'.`,
          {
            code:
              ErrorCodes
                .OPERATION_PLAN_DRIFT,
            suggestion:
              "Regenerate and inspect the plan before applying it.",
          }
        );
      }

      prepared.push({
        operation,
        target,
      });
    }

    return prepared;
  }

  private async writePreparedPlan(
    validated: OperationPlan,
    boundary: ProjectPathBoundary,
    lifecycleLock: ProjectLifecycleLock
  ): Promise<void> {
    let transaction: DurableOperationTransaction;
    try {
      transaction = await DurableOperationTransaction.prepare(validated,
        boundary.projectRoot, lifecycleLock, new Date(this.now()).toISOString());
    } catch (error) {
      if (error instanceof AuroraError) throw error;
      throw operationPlanError("Operation plan could not safely prepare its durable recovery evidence.", error);
    }
    try {
      assertPlanNotExpired(validated, this.now());
      await transaction.beginMutation();
      for (const operation of validated.operations) {
        if (operation.kind === "file.write") await transaction.writeOperation(operation.id);
      }
      await transaction.beginVerification();
      await transaction.commitDurably();
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (recoveryError) {
        throw new AuroraError("Operation plan did not finish cleanly; its recovery record was retained. No conflicting edits were overwritten.", {
          code: recoveryError instanceof AuroraError && recoveryError.code === ErrorCodes.OPERATION_RECOVERY_CONFLICT
            ? ErrorCodes.OPERATION_RECOVERY_CONFLICT : ErrorCodes.INVALID_OPERATION_PLAN,
          suggestion: "Use 'aurora recovery plans --project <path>' to inspect the record before an approved recovery.",
          cause: new AggregateError([error, recoveryError]),
        });
      }
      if (error instanceof AuroraError) throw error;
      throw operationPlanError("Operation plan failed and its owned file changes were recovered.", error);
    }
  }
}

function assertPlanNotExpired(plan: OperationPlan, now: number): void {
  if (now >= Date.parse(plan.expiresAt)) {
    throw new AuroraError("Operation plan has expired.", {
      code: ErrorCodes.OPERATION_PLAN_EXPIRED,
      suggestion: "Generate and inspect a new plan from the current project state.",
    });
  }
}

function assertNotLifecycleAuthorityPath(relativePath: string): void {
  const normalized = relativePath.toLowerCase();
  if (
    normalized === ".aurora" ||
    normalized === ".aurora/lifecycle-lock" ||
    normalized.startsWith(".aurora/lifecycle-lock/") ||
    normalized.startsWith(".aurora/.lifecycle-lock-candidate-") ||
    normalized.startsWith(".aurora/.lifecycle-lock-release-") ||
    normalized.startsWith(".aurora/.lifecycle-lock-reclaim-") ||
    normalized.startsWith(".aurora/.operation-journal-candidate-") ||
    normalized === ".aurora/operation-journal" ||
    normalized.startsWith(".aurora/operation-journal/") ||
    normalized === ".aurora/lifecycle-journal" ||
    normalized.startsWith(".aurora/lifecycle-journal/")
  ) {
    throw operationPlanError(
      "Operation plans must not write lifecycle lock or recovery metadata."
    );
  }
}

export async function assertLifecycleJournalsCommitted(
  boundary: ProjectPathBoundary
): Promise<void> {
  let directory: Dir;
  try {
    directory = await fs.opendir(boundary.resolve(".aurora/lifecycle-journal"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const rootDigest = sha256(boundary.projectRoot);
  let count = 0;
  try {
    let entry: Dirent | null;
    while ((entry = await directory.read()) !== null) {
      if (++count > MAX_LIFECYCLE_JOURNALS) {
        throw new Error("Lifecycle journal inspection limit exceeded.");
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("Unsafe lifecycle journal directory.");
      }
      if (entry.name === "recovered") continue;

      const id = parseLifecycleTransactionId(entry.name);
      const content = await readStableFileContent(
        boundary.resolve(`.aurora/lifecycle-journal/${id}/journal.json`),
        LIFECYCLE_JOURNAL_MAX_BYTES
      );
      if (content === null) throw new Error("Lifecycle journal envelope is missing.");
      const journal = parseLifecycleJournalEnvelope(parsePackageManifestBytes(content));
      if (journal.transactionId !== id || journal.projectRootSha256 !== rootDigest) {
        throw new Error("Lifecycle journal binding mismatch.");
      }
      if (journal.phase !== "committed") {
        throw new Error("An incomplete package lifecycle transaction requires recovery.");
      }
    }
  } finally {
    await directory.close();
  }
}

export function createProjectFingerprint(
  projectRoot: string
): string {
  const canonicalRoot =
    new ProjectPathBoundary(
      projectRoot
    ).projectRoot;

  const normalizedRoot =
    process.platform === "win32"
      ? canonicalRoot.toLowerCase()
      : canonicalRoot;

  return sha256(
    normalizedRoot
  );
}

export function sha256(
  value: string | Buffer
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

async function readFileState(
  target: string
): Promise<ExpectedFileState> {
  const content = await readStableFileContent(target, MAX_PLAN_FILE_BYTES);
  return content === null
    ? { exists: false }
    : { exists: true, sha256: sha256(content) };
}

async function readStableFileContent(
  target: string,
  maximumBytes: number
): Promise<Buffer | null> {
  let handle:
    fs.FileHandle | undefined;

  let before: Stats;
  try {
    before = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw operationPlanError(
      "Planned file target could not be inspected safely.", error
    );
  }

  try {
    if (!before.isFile() || before.nlink !== 1) {
      throw operationPlanError(
        "Planned file target must be absent or a regular file with no additional links."
      );
    }
    if (before.size > maximumBytes) {
      throw operationPlanError(
        "Inspected file is larger than the supported size limit."
      );
    }

    handle = await fs.open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );

    const information =
      await handle.stat();
    const pathInformation =
      await fs.lstat(target);

    if (
      !information.isFile() ||
      !pathInformation.isFile() ||
      information.nlink !== 1 ||
      pathInformation.nlink !== 1 ||
      pathInformation
        .isSymbolicLink() ||
      !sameFileIdentity(before, information) ||
      fileChangedWhileReading(before, information) ||
      !sameFileIdentity(
        information,
        pathInformation
      )
    ) {
      throw operationPlanError(
        "Planned file target must be absent or a regular file."
      );
    }

    if (
      information.size >
      maximumBytes
    ) {
      throw operationPlanError(
        "Inspected file is larger than the supported size limit."
      );
    }

    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer, length, buffer.length - length, length
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const completedInformation =
      await handle.stat();
    const completedPathInformation = await fs.lstat(target);

    if (
      length !== before.size ||
      length > maximumBytes ||
      !completedPathInformation.isFile() ||
      completedPathInformation.nlink !== 1 ||
      !sameFileIdentity(before, completedPathInformation) ||
      fileChangedWhileReading(before, completedPathInformation) ||
      fileChangedWhileReading(
        information,
        completedInformation
      )
    ) {
      throw operationPlanError(
        "Planned file target changed while it was being inspected."
      );
    }

    return buffer.subarray(0, length);
  } catch (error) {
    if (
      error instanceof AuroraError
    ) {
      throw error;
    }

    throw operationPlanError(
      "Planned file target could not be inspected safely.",
      error
    );
  } finally {
    await handle?.close();
  }
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
    before.nlink !== after.nlink ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  );
}

function fileStatesEqual(
  expected: ExpectedFileState,
  actual: ExpectedFileState
): boolean {
  if (
    expected.exists !==
    actual.exists
  ) {
    return false;
  }

  if (
    !expected.exists ||
    !actual.exists
  ) {
    return true;
  }

  return expected.sha256 ===
    actual.sha256;
}

function operationPlanError(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    message,
    {
      code:
        ErrorCodes
          .INVALID_OPERATION_PLAN,
      suggestion:
        "Regenerate the plan from the current project and inspect it before applying.",
      cause,
    }
  );
}

/** Enforce the envelope limit before more expensive field and secret checks. */
function parseBoundedPlan(value: unknown): OperationPlan {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PLAN_FILE_BYTES) {
    throw operationPlanError("Operation Plan v1 must not exceed 1 MiB.");
  }
  return parseOperationPlan(value);
}
