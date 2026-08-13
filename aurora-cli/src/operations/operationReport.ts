import {
  randomUUID,
} from "node:crypto";

import {
  z,
} from "zod";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  redactText,
} from "../security/secretRedactor.js";

import {
  PlanOperationKindSchema,
  type OperationPlan,
} from "./operationPlan.js";

export const OPERATION_REPORT_SCHEMA_VERSION =
  1 as const;

const DigestSchema =
  z.string().regex(
    /^[a-f0-9]{64}$/u,
    "Expected a lowercase SHA-256 digest."
  );

const TimestampSchema =
  z.iso.datetime({
    offset: false,
    precision: 3,
  }).refine(
    value =>
      new Date(value)
        .toISOString() === value,
    "Expected an ISO timestamp."
  );

const ReportOperationSchema =
  z.object({
    operationId: z.string().regex(
      /^op-[0-9]{3,6}$/u
    ),
    kind:
      PlanOperationKindSchema,
    status: z.enum([
      "applied",
      "validated",
    ]),
  }).strict();

export const OperationReportSchema =
  z.object({
    schemaVersion:
      z.literal(
        OPERATION_REPORT_SCHEMA_VERSION
      ),
    reportId: z.string().regex(
      /^report-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
    ),
    planId: z.string().regex(
      /^plan-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
    ),
    intent: z.string().regex(
      /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u
    ).max(128),
    projectFingerprint:
      DigestSchema,
    status: z.enum([
      "applied",
      "dry-run",
    ]),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    operations: z.array(
      ReportOperationSchema
    ).min(1).max(100),
    totals: z.object({
      planned:
        z.number().int().min(1),
      validated:
        z.number().int().min(0),
      applied:
        z.number().int().min(0),
      failed:
        z.literal(0),
    }).strict(),
  }).strict()
    .superRefine(
      (report, context) => {
        if (
          Date.parse(
            report.completedAt
          ) <
          Date.parse(
            report.startedAt
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "completedAt",
            ],
            message:
              "Report completion cannot precede its start.",
          });
        }

        if (
          report.totals.planned !==
            report.operations.length ||
          report.totals.validated !==
            report.operations.length ||
          (
            report.status ===
              "applied" &&
            report.totals.applied !==
              report.operations.length
          ) ||
          (
            report.status ===
              "dry-run" &&
            report.totals.applied !== 0
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "totals",
            ],
            message:
              "Report totals do not match its operation outcomes.",
          });
        }

        const expectedStatus =
          report.status === "applied"
            ? "applied"
            : "validated";

        if (
          report.operations.some(
            operation =>
              operation.status !==
                expectedStatus
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "operations",
            ],
            message:
              "Operation outcomes do not match the report status.",
          });
        }
      }
    );

export type OperationReport =
  z.infer<
    typeof OperationReportSchema
  >;

export function createOperationReport(
  plan: OperationPlan,
  status:
    OperationReport["status"],
  startedAt: string,
  completedAt: string
): OperationReport {
  const operationStatus =
    status === "applied"
      ? "applied"
      : "validated";

  return parseOperationReport({
    schemaVersion: 1,
    reportId:
      `report-${randomUUID()}`,
    planId: plan.id,
    intent: plan.intent,
    projectFingerprint:
      plan.projectFingerprint,
    status,
    startedAt,
    completedAt,
    operations:
      plan.operations.map(
        operation => ({
          operationId:
            operation.id,
          kind: operation.kind,
          status:
            operationStatus,
        })
      ),
    totals: {
      planned:
        plan.operations.length,
      validated:
        plan.operations.length,
      applied:
        status === "applied"
          ? plan.operations.length
          : 0,
      failed: 0,
    },
  });
}

export function parseOperationReport(
  value: unknown
): OperationReport {
  const result =
    OperationReportSchema.safeParse(
      value
    );

  if (result.success) {
    return result.data;
  }

  const details =
    result.error.issues.map(
      issue => {
        const location =
          issue.path.length > 0
            ? issue.path.join(".")
            : "report";

        return `${location}: ${issue.message}`;
      }
    ).join("; ");

  throw new AuroraError(
    `Invalid Operation Report v1: ${redactText(details)}`,
    {
      code:
        ErrorCodes
          .INVALID_OPERATION_REPORT,
      suggestion:
        "Regenerate the operation report from a validated Aurora plan.",
    }
  );
}
