import {
  createHash,
  randomUUID,
} from "node:crypto";

import fs from "node:fs/promises";
import path from "node:path";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  FileTransaction,
} from "../core/fileTransaction.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

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

const SUPPORTED_OPERATION_KINDS =
  new Set<PlanOperation["kind"]>([
    "file.write",
  ]);

export interface PlanClock {
  now(): number;
}

export interface CreateFileWritePlanOptions {
  readonly projectRoot: string;

  readonly relativePath: string;

  readonly content: string;

  readonly summary: string;

  readonly intent: string;

  readonly description?: string;

  readonly mode?: number;

  readonly directoryMode?: number;

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
    const boundary =
      new ProjectPathBoundary(
        options.projectRoot
      );

    const relativePath =
      normalizePlanPath(
        options.relativePath
      );

    const target =
      boundary.resolve(
        relativePath
      );

    const expected =
      await readFileState(target);

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

    const operation:
      FileWriteOperation = {
        id: "op-001",
        kind: "file.write",
        risk: "low",
        description:
          options.description ??
          `Write ${relativePath}`,
        path: relativePath,
        content: options.content,
        contentSha256:
          sha256(options.content),
        expected,
        ...(options.mode === undefined
          ? {}
          : {
              mode: options.mode,
            }),
        ...(options.directoryMode ===
          undefined
          ? {}
          : {
              directoryMode:
                options.directoryMode,
            }),
      };

    return parseOperationPlan({
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
      operations: [
        operation,
      ],
    });
  }

  async readPlanFile(
    planFile: string
  ): Promise<OperationPlan> {
    const absolutePlanFile =
      path.resolve(planFile);

    let information;

    try {
      information =
        await fs.lstat(
          absolutePlanFile
        );
    } catch (error) {
      throw operationPlanError(
        `Operation plan file could not be read: ${absolutePlanFile}`,
        error
      );
    }

    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      information.size >
        MAX_PLAN_FILE_BYTES
    ) {
      throw operationPlanError(
        "Operation plan must be a regular JSON file no larger than 1 MiB."
      );
    }

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

      if (
        !openedInformation.isFile() ||
        openedInformation.size >
          MAX_PLAN_FILE_BYTES ||
        openedInformation.dev !==
          information.dev ||
        openedInformation.ino !==
          information.ino
      ) {
        throw operationPlanError(
          "Operation plan file changed while it was being opened."
        );
      }

      raw = await handle.readFile({
        encoding: "utf8",
      });

      const completedInformation =
        await handle.stat();

      if (
        completedInformation.size !==
          openedInformation.size ||
        completedInformation.mtimeMs !==
          openedInformation.mtimeMs ||
        completedInformation.ctimeMs !==
          openedInformation.ctimeMs
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

    if (
      this.now() >=
      Date.parse(
        validated.expiresAt
      )
    ) {
      throw new AuroraError(
        "Operation plan has expired.",
        {
          code:
            ErrorCodes
              .OPERATION_PLAN_EXPIRED,
          suggestion:
            "Generate and inspect a new plan from the current project state.",
        }
      );
    }

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
    }

    const prepared = [] as Array<{
      operation:
        FileWriteOperation;
      target: string;
    }>;

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

      if (
        sha256(operation.content) !==
        operation.contentSha256
      ) {
        throw operationPlanError(
          `Operation '${operation.id}' content digest does not match its plan.`
        );
      }

      const target =
        boundary.resolve(
          operation.path
        );

      const actual =
        await readFileState(
          target
        );

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

    if (options.dryRun) {
      return createOperationReport(
        validated,
        "dry-run",
        startedAt,
        new Date(this.now())
          .toISOString()
      );
    }

    const transaction =
      new FileTransaction(
        `operation plan ${validated.id}`,
        boundary.projectRoot
      );

    try {
      for (
        const item of prepared
      ) {
        await transaction
          .recordModifiedFile(
            item.target
          );

        await transaction
          .recordDirectoryMode(
            path.dirname(
              item.target
            )
          );

        await transaction
          .ensureDirectory(
            path.dirname(
              item.target
            )
          );

        const revalidatedTarget =
          boundary.resolve(
            item.operation.path
          );

        const revalidatedState =
          await readFileState(
            revalidatedTarget
          );

        if (
          !fileStatesEqual(
            item.operation.expected,
            revalidatedState
          )
        ) {
          throw new AuroraError(
            `Project state changed while applying '${item.operation.path}'.`,
            {
              code:
                ErrorCodes
                  .OPERATION_PLAN_DRIFT,
              suggestion:
                "Regenerate and inspect the plan before applying it.",
            }
          );
        }

        await fs.writeFile(
          revalidatedTarget,
          item.operation.content,
          {
            encoding: "utf8",
            ...(item.operation.mode ===
            undefined
              ? {}
              : {
                  mode:
                    item.operation.mode,
                }),
          }
        );

        if (
          item.operation.mode !==
            undefined
        ) {
          await fs.chmod(
            revalidatedTarget,
            item.operation.mode
          );
        }

        if (
          item.operation
            .directoryMode !==
            undefined
        ) {
          await fs.chmod(
            path.dirname(
              revalidatedTarget
            ),
            item.operation
              .directoryMode
          );
        }
      }

      transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    return createOperationReport(
      validated,
      "applied",
      startedAt,
      new Date(this.now())
        .toISOString()
    );
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
  try {
    const information =
      await fs.lstat(target);

    if (
      information.isSymbolicLink() ||
      !information.isFile()
    ) {
      throw operationPlanError(
        "Planned file target must be absent or a regular file."
      );
    }

    if (
      information.size >
      MAX_PLAN_FILE_BYTES
    ) {
      throw operationPlanError(
        "Planned file target is larger than the 1 MiB planning limit."
      );
    }

    const content =
      await fs.readFile(target);

    return {
      exists: true,
      sha256: sha256(content),
    };
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

    if (code === "ENOENT") {
      return {
        exists: false,
      };
    }

    throw operationPlanError(
      "Planned file target could not be inspected safely.",
      error
    );
  }
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
