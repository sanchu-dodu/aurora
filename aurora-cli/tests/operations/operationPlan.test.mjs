import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  open,
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
    const blockedPath = join(
      projectRoot,
      "blocked"
    );

    try {
      await writeFile(
        firstFile,
        "original\n",
        {
          encoding: "utf8",
          mode: 0o640,
        }
      );
      await writeFile(
        blockedPath,
        "not a directory\n",
        "utf8"
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
                "Trigger a directory conflict.",
              path:
                "blocked/second.txt",
              content: "second\n",
              contentSha256:
                sha256("second\n"),
              expected: {
                exists: false,
              },
            },
          ],
        });

      await assert.rejects(
        service.apply(
          plan,
          projectRoot,
          {
            approved: true,
          }
        )
      );

      const restoredFile =
        await open(firstFile, "r");

      try {
        const restoredInformation =
          await restoredFile.stat();

        assert.equal(
          await restoredFile.readFile({
            encoding: "utf8",
          }),
          "original\n"
        );
        assert.equal(
          restoredInformation.mode &
            0o777,
          originalFileMode
        );
      } finally {
        await restoredFile.close();
      }
      assert.equal(
        (
          await stat(projectRoot)
        ).mode & 0o777,
        originalRootMode
      );
    } finally {
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
