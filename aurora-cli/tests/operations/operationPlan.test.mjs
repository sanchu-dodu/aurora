import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  createConfigSetPlan,
} from "../../dist/operations/configPlan.js";

import {
  parseOperationPlan,
} from "../../dist/operations/operationPlan.js";

import {
  createOperationReport,
  parseOperationReport,
} from "../../dist/operations/operationReport.js";

import {
  OperationPlanService,
  sha256,
} from "../../dist/operations/operationPlanService.js";

import {
  DurableOperationTransaction,
} from "../../dist/operations/durableOperationTransaction.js";

const NOW =
  Date.parse(
    "2026-08-13T08:00:00.000Z"
  );

function createService(
  now = NOW
) {
  return new OperationPlanService({
    now: () => now,
  });
}

test(
  "Operation Plan v1 creates and applies a project-bound configuration write",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-operation-apply-"
      );

    try {
      const service =
        createService();
      const plan =
        await createConfigSetPlan(
          "packageManager",
          "pnpm",
          projectRoot,
          service
        );

      assert.equal(
        plan.schemaVersion,
        1
      );
      assert.equal(
        plan.requiresApproval,
        true
      );
      assert.equal(
        plan.operations[0].kind,
        "file.write"
      );
      assert.equal(
        plan.operations[0].path,
        ".aurora/config.json"
      );

      await assert.rejects(
        service.apply(
          plan,
          projectRoot,
          {
            approved: false,
          }
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .OPERATION_APPROVAL_REQUIRED
          );
          return true;
        }
      );

      const result =
        await service.apply(
          plan,
          projectRoot,
          {
            approved: true,
          }
        );

      assert.equal(
        result.status,
        "applied"
      );
      assert.equal(
        result.schemaVersion,
        1
      );
      assert.match(
        result.reportId,
        /^report-/u
      );
      assert.deepEqual(
        result.totals,
        {
          planned: 1,
          validated: 1,
          applied: 1,
          failed: 0,
        }
      );
      assert.deepEqual(
        result.operations,
        [
          {
            operationId:
              "op-001",
            kind: "file.write",
            status: "applied",
          },
        ]
      );

      const saved =
        JSON.parse(
          await readFile(
            join(
              projectRoot,
              ".aurora",
              "config.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        saved.packageManager,
        "pnpm"
      );
    } finally {
      await removeProject(
        projectRoot
      );
    }
  }
);

test(
  "dry runs validate without writing and expired plans fail closed",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-operation-dry-run-"
      );

    try {
      const service =
        createService();
      const plan =
        await createConfigSetPlan(
          "initializeGit",
          "false",
          projectRoot,
          service
        );

      const dryRun =
        await service.apply(
          plan,
          projectRoot,
          {
            approved: false,
            dryRun: true,
          }
        );

      assert.equal(
        dryRun.status,
        "dry-run"
      );
      assert.equal(
        dryRun.totals.applied,
        0
      );
      assert.equal(
        dryRun.operations[0]
          .status,
        "validated"
      );

      await assert.rejects(
        readFile(
          join(
            projectRoot,
            ".aurora",
            "config.json"
          )
        ),
        error =>
          error.code === "ENOENT"
      );

      const expiredService =
        createService(
          Date.parse(
            plan.expiresAt
          )
        );

      await assert.rejects(
        expiredService.apply(
          plan,
          projectRoot,
          {
            approved: true,
          }
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .OPERATION_PLAN_EXPIRED
          );
          return true;
        }
      );
    } finally {
      await removeProject(
        projectRoot
      );
    }
  }
);

test(
  "plans reject content tampering, project mismatch, and file drift",
  async () => {
    const firstRoot =
      await temporaryProject(
        "aurora-operation-first-"
      );
    const secondRoot =
      await temporaryProject(
        "aurora-operation-second-"
      );

    try {
      const service =
        createService();
      const plan =
        await createConfigSetPlan(
          "language",
          "javascript",
          firstRoot,
          service
        );

      const tampered =
        structuredClone(plan);

      tampered.operations[0]
        .content =
          "tampered";

      await assert.rejects(
        service.apply(
          tampered,
          firstRoot,
          {
            approved: true,
          }
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_PLAN
          );
          return true;
        }
      );

      await assert.rejects(
        service.apply(
          plan,
          secondRoot,
          {
            approved: true,
          }
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_PLAN
          );
          return true;
        }
      );

      const configPath = join(
        firstRoot,
        ".aurora",
        "config.json"
      );

      await mkdir(
        dirname(configPath),
        {
          recursive: true,
        }
      );
      await writeFile(
        configPath,
        "{}\n",
        "utf8"
      );

      await assert.rejects(
        service.apply(
          plan,
          firstRoot,
          {
            approved: true,
          }
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .OPERATION_PLAN_DRIFT
          );
          return true;
        }
      );
    } finally {
      await removeProject(
        firstRoot
      );
      await removeProject(
        secondRoot
      );
    }
  }
);

test(
  "plan files are strict, secret-free, non-overwriting, and reject unsupported executors",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-operation-file-"
      );
    const outputRoot =
      await temporaryProject(
        "aurora-operation-output-"
      );

    try {
      const service =
        createService();
      const plan =
        await createConfigSetPlan(
          "packageManager",
          "yarn",
          projectRoot,
          service
        );
      const planFile = join(
        outputRoot,
        "config-plan.json"
      );

      await service.writePlanFile(
        plan,
        planFile
      );

      assert.deepEqual(
        await service.readPlanFile(
          planFile
        ),
        plan
      );

      await assert.rejects(
        service.writePlanFile(
          plan,
          planFile
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_PLAN
          );
          return true;
        }
      );

      assert.throws(
        () =>
          parseOperationPlan({
            ...plan,
            summary:
              "Authorization: Bearer hidden-value",
          }),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_PLAN
          );
          assert.equal(
            error.message.includes(
              "hidden-value"
            ),
            false
          );
          return true;
        }
      );

      assert.throws(
        () =>
          parseOperationPlan({
            ...plan,
            operations: [
              {
                ...plan.operations[0],
                path:
                  ".aurora\\config.json",
              },
            ],
          }),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_PLAN
          );
          return true;
        }
      );

      const unsupported =
        parseOperationPlan({
          ...plan,
          operations: [
            {
              id: "op-001",
              kind:
                "policy.check",
              risk: "low",
              description:
                "Require review policy.",
              policyId:
                "review.required",
              requirement:
                "Require explicit review.",
            },
          ],
        });

      await assert.rejects(
        service.apply(
          unsupported,
          projectRoot,
          {
            approved: true,
          }
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_PLAN
          );
          return true;
        }
      );
    } finally {
      await removeProject(
        projectRoot
      );
      await removeProject(
        outputRoot
      );
    }
  }
);

test(
  "Operation Report v1 is strict and internally consistent",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-operation-report-"
      );

    try {
      const service =
        createService();
      const plan =
        await createConfigSetPlan(
          "packageManager",
          "pnpm",
          projectRoot,
          service
        );
      const report =
        createOperationReport(
          plan,
          "dry-run",
          plan.createdAt,
          plan.createdAt
        );

      assert.deepEqual(
        parseOperationReport(
          report
        ),
        report
      );

      assert.throws(
        () =>
          parseOperationReport({
            ...report,
            totals: {
              ...report.totals,
              applied: 1,
            },
          }),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_REPORT
          );
          return true;
        }
      );

      assert.throws(
        () =>
          parseOperationReport({
            ...report,
            unexpected: true,
          }),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_OPERATION_REPORT
          );
          return true;
        }
      );
    } finally {
      await removeProject(
        projectRoot
      );
    }
  }
);

test(
  "batch file plans snapshot each target without writing and apply together",
  async () => {
    const projectRoot = await temporaryProject("aurora-operation-batch-");
    try {
      await writeFile(join(projectRoot, "existing.txt"), "original\n", "utf8");
      const service = createService();
      const plan = await service.createFileWriteBatchPlan({
        projectRoot,
        intent: "test.batch-write",
        summary: "Write the two project files.",
        lifetimeMs: 1000,
        files: [
          {
            relativePath: "./existing.txt",
            content: "replacement\n",
            description: "Update the existing file.",
            mode: 0o600,
          },
          {
            relativePath: "new\\file.txt",
            content: "created\n",
            directoryMode: 0o700,
          },
        ],
      });
      assert.deepEqual(plan.operations.map(operation => operation.id), ["op-001", "op-002"]);
      assert.deepEqual(plan.operations.map(operation => operation.path), ["existing.txt", "new/file.txt"]);
      assert.deepEqual(plan.operations.map(operation => operation.expected), [
        { exists: true, sha256: sha256("original\n") },
        { exists: false },
      ]);
      assert.equal(plan.operations[0].description, "Update the existing file.");
      assert.equal(plan.operations[0].mode, 0o600);
      assert.equal(plan.operations[1].directoryMode, 0o700);
      assert.equal(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt), 1000);
      assert.equal(await readFile(join(projectRoot, "existing.txt"), "utf8"), "original\n");
      await assert.rejects(readFile(join(projectRoot, "new", "file.txt")), error => error.code === "ENOENT");

      const dryRun = await service.apply(plan, projectRoot, { approved: false, dryRun: true });
      assert.equal(dryRun.totals.validated, 2);
      assert.equal(await readFile(join(projectRoot, "existing.txt"), "utf8"), "original\n");
      const report = await service.apply(plan, projectRoot, { approved: true });
      assert.equal(report.totals.applied, 2);
      assert.equal(await readFile(join(projectRoot, "existing.txt"), "utf8"), "replacement\n");
      assert.equal(await readFile(join(projectRoot, "new", "file.txt"), "utf8"), "created\n");
    } finally {
      await removeProject(projectRoot);
    }
  }
);

test(
  "batch builder preserves schema limits and rejects duplicate or overlapping paths",
  async () => {
    const projectRoot = await temporaryProject("aurora-operation-batch-invalid-");
    try {
      const service = createService();
      const base = { projectRoot, intent: "test.batch-write", summary: "Validate batch limits." };
      const file = { relativePath: "folder/value.txt", content: "value\n" };
      const invalidFiles = [
        [],
        Array.from({ length: 101 }, (_, index) => ({ ...file, relativePath: `file-${index}.txt` })),
        [file, { ...file, relativePath: "./folder//value.txt" }],
        [file, { ...file, relativePath: "FOLDER/VALUE.TXT" }],
        [file, { ...file, relativePath: "folder" }],
        [{ ...file, relativePath: "folder" }, file],
        [{ ...file, relativePath: "../outside.txt" }],
        [{ ...file, mode: 0o1000 }],
        [{ ...file, content: "Authorization: Bearer hidden-value" }],
        [{ ...file, content: "x".repeat(1024 * 1024) }],
      ];
      for (const files of invalidFiles) {
        await assert.rejects(service.createFileWriteBatchPlan({ ...base, files }),
          error => error.code === ErrorCodes.INVALID_OPERATION_PLAN);
      }
      for (const lifetimeMs of [0, -1, 1.5, 24 * 60 * 60 * 1000 + 1]) {
        await assert.rejects(service.createFileWriteBatchPlan({ ...base, files: [file], lifetimeMs }),
          error => error.code === ErrorCodes.INVALID_OPERATION_PLAN);
      }
      const maximum = await service.createFileWriteBatchPlan({
        ...base,
        files: Array.from({ length: 100 }, (_, index) => ({ ...file, relativePath: `file-${index}.txt` })),
      });
      assert.equal(maximum.operations.length, 100);
      assert.equal(maximum.operations.at(-1).id, "op-100");
    } finally {
      await removeProject(projectRoot);
    }
  }
);

test(
  "drift in a later batch target prevents every write",
  async () => {
    const projectRoot = await temporaryProject("aurora-operation-batch-drift-");
    try {
      const service = createService();
      const plan = await service.createFileWriteBatchPlan({
        projectRoot,
        intent: "test.batch-write",
        summary: "Add two files.",
        files: [
          { relativePath: "first.txt", content: "first\n" },
          { relativePath: "second.txt", content: "second\n" },
        ],
      });
      await writeFile(join(projectRoot, "second.txt"), "user edit\n", "utf8");
      await assert.rejects(service.apply(plan, projectRoot, { approved: true }),
        error => error.code === ErrorCodes.OPERATION_PLAN_DRIFT);
      await assert.rejects(readFile(join(projectRoot, "first.txt")), error => error.code === "ENOENT");
      assert.equal(await readFile(join(projectRoot, "second.txt"), "utf8"), "user edit\n");
    } finally {
      await removeProject(projectRoot);
    }
  }
);

test(
  "planning and applying reject hard-linked targets without modifying their content",
  async context => {
    const projectRoot = await temporaryProject("aurora-operation-hard-link-");
    try {
      const target = join(projectRoot, "target.txt");
      const other = join(projectRoot, "other.txt");
      await writeFile(target, "original\n", "utf8");
      const service = createService();
      const options = {
        projectRoot,
        relativePath: "target.txt",
        content: "replacement\n",
        intent: "test.link-write",
        summary: "Reject linked writes.",
      };
      const plan = await service.createFileWritePlan(options);
      try {
        await link(target, other);
      } catch (error) {
        if (["EPERM", "EOPNOTSUPP", "ENOTSUP", "ENOSYS"].includes(error.code)) {
          context.skip("File system does not permit hard links.");
          return;
        }
        throw error;
      }
      await assert.rejects(service.createFileWritePlan(options),
        error => error.code === ErrorCodes.INVALID_OPERATION_PLAN);
      await assert.rejects(service.apply(plan, projectRoot, { approved: true }),
        error => error.code === ErrorCodes.INVALID_OPERATION_PLAN);
      assert.equal(await readFile(target, "utf8"), "original\n");
      assert.equal(await readFile(other, "utf8"), "original\n");
    } finally {
      await removeProject(projectRoot);
    }
  }
);

test(
  "planning rejects directories and files above the bounded snapshot limit",
  async () => {
    const projectRoot = await temporaryProject("aurora-operation-unsafe-target-");
    try {
      await mkdir(join(projectRoot, "directory"));
      await writeFile(join(projectRoot, "large.txt"), Buffer.alloc(1024 * 1024 + 1));
      await writeFile(join(projectRoot, "bounded.txt"), Buffer.alloc(1024 * 1024));
      const service = createService();
      for (const relativePath of ["directory", "large.txt"]) {
        await assert.rejects(service.createFileWritePlan({
          projectRoot,
          relativePath,
          content: "replacement\n",
          intent: "test.unsafe-write",
          summary: "Reject unsafe targets.",
        }), error => error.code === ErrorCodes.INVALID_OPERATION_PLAN);
      }
      const plan = await service.createFileWritePlan({
        projectRoot,
        relativePath: "bounded.txt",
        content: "replacement\n",
        intent: "test.bounded-write",
        summary: "Snapshot the largest allowed target.",
      });
      assert.deepEqual(plan.operations[0].expected,
        { exists: true, sha256: sha256(Buffer.alloc(1024 * 1024)) });
    } finally {
      await removeProject(projectRoot);
    }
  }
);

test(
  "planning rejects FIFO targets before opening them",
  { skip: process.platform === "win32", timeout: 2000 },
  async () => {
    const projectRoot = await temporaryProject("aurora-operation-fifo-");
    try {
      execFileSync("mkfifo", [join(projectRoot, "pipe")]);
      await assert.rejects(createService().createFileWritePlan({
        projectRoot,
        relativePath: "pipe",
        content: "replacement\n",
        intent: "test.fifo-write",
        summary: "Reject FIFO targets.",
      }), error => error.code === ErrorCodes.INVALID_OPERATION_PLAN);
    } finally {
      await removeProject(projectRoot);
    }
  }
);

test(
  "multi-operation apply rolls content and permissions back atomically",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-operation-rollback-"
      );
    const firstFile = join(
      projectRoot,
      "first.txt"
    );
    const writeOperation = DurableOperationTransaction.prototype.writeOperation;

    try {
      await writeFile(
        firstFile,
        "original\n",
        {
          encoding: "utf8",
          mode: 0o640,
        }
      );
      const originalFileMode =
        (
          await stat(firstFile)
        ).mode & 0o777;
      const originalRootMode =
        (
          await stat(projectRoot)
        ).mode & 0o777;
      const service =
        createService();
      const base =
        await service
          .createFileWritePlan({
            projectRoot,
            relativePath:
              "first.txt",
            content: "changed\n",
            intent:
              "test.atomic-write",
            summary:
              "Verify atomic file writes.",
            mode: 0o600,
            directoryMode: 0o700,
          });
      const plan =
        parseOperationPlan({
          ...base,
          operations: [
            base.operations[0],
            {
              id: "op-002",
              kind: "file.write",
              risk: "low",
              description:
                "Trigger a durable write failure.",
              path:
                "second.txt",
              content: "second\n",
              contentSha256:
                sha256("second\n"),
              expected: {
                exists: false,
              },
            },
          ],
        });

      DurableOperationTransaction.prototype.writeOperation = async function (operationId, ...args) {
        if (operationId === "op-002") throw new Error("Injected durable write failure");
        return writeOperation.call(this, operationId, ...args);
      };

      await assert.rejects(
        service.apply(
          plan,
          projectRoot,
          {
            approved: true,
          }
        ),
        error => {
          assert.equal(error.code, ErrorCodes.INVALID_OPERATION_PLAN);
          assert.equal(error.cause?.message, "Injected durable write failure");
          return true;
        }
      );

      const restoredInformation =
        await stat(firstFile);

      assert.equal(
        await readFile(firstFile, "utf8"),
        "original\n"
      );
      assert.equal(
        restoredInformation.mode &
          0o777,
        originalFileMode
      );
      assert.equal(
        (
          await stat(projectRoot)
        ).mode & 0o777,
        originalRootMode
      );
    } finally {
      DurableOperationTransaction.prototype.writeOperation = writeOperation;
      await removeProject(
        projectRoot
      );
    }
  }
);

async function temporaryProject(
  prefix
) {
  return mkdtemp(
    join(
      tmpdir(),
      prefix
    )
  );
}

async function removeProject(
  projectRoot
) {
  await rm(
    projectRoot,
    {
      recursive: true,
      force: true,
    }
  );
}
