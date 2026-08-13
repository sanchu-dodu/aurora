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

export const OPERATION_PLAN_SCHEMA_VERSION =
  1 as const;

export const MAX_PLAN_FILE_BYTES =
  1024 * 1024;

const DigestSchema =
  z.string().regex(
    /^[a-f0-9]{64}$/u,
    "Expected a lowercase SHA-256 digest."
  );

const CanonicalIdentifierSchema =
  z.string().regex(
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u,
    "Expected a canonical lowercase identifier."
  ).max(128);

const DescriptionSchema =
  z.string().trim().min(1).max(500);

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

const RelativePlanPathSchema =
  z.string().min(1).max(4096)
    .refine(
      isSafeRelativePath,
      "Expected a safe project-relative path."
    )
    .refine(
      value =>
        isSafeRelativePath(value) &&
        value ===
          normalizePlanPath(value),
      "Expected a canonical forward-slash project path."
    );

const ExpectedFileStateSchema =
  z.discriminatedUnion(
    "exists",
    [
      z.object({
        exists: z.literal(false),
      }).strict(),

      z.object({
        exists: z.literal(true),
        sha256: DigestSchema,
      }).strict(),
    ]
  );

const BaseOperationShape = {
  id: z.string().regex(
    /^op-[0-9]{3,6}$/u,
    "Expected an operation identifier such as 'op-001'."
  ),
  description: DescriptionSchema,
  risk: z.enum([
    "low",
    "moderate",
    "high",
  ]),
} as const;

export const PlanOperationKindSchema =
  z.enum([
    "file.write",
    "file.delete",
    "dependency.change",
    "command.run",
    "policy.check",
    "remote-state.change",
  ]);

export const FileWriteOperationSchema =
  z.object({
    ...BaseOperationShape,
    kind: z.literal("file.write"),
    path: RelativePlanPathSchema,
    content: z.string().max(
      MAX_PLAN_FILE_BYTES
    ),
    contentSha256: DigestSchema,
    expected: ExpectedFileStateSchema,
    mode: z.number().int()
      .min(0)
      .max(0o777)
      .optional(),
    directoryMode: z.number().int()
      .min(0)
      .max(0o777)
      .optional(),
  }).strict();

export const FileDeleteOperationSchema =
  z.object({
    ...BaseOperationShape,
    kind: z.literal("file.delete"),
    path: RelativePlanPathSchema,
    expected: ExpectedFileStateSchema,
  }).strict();

export const DependencyChangeOperationSchema =
  z.object({
    ...BaseOperationShape,
    kind: z.literal(
      "dependency.change"
    ),
    action: z.enum([
      "install",
      "remove",
    ]),
    manager: z.enum([
      "bun",
      "npm",
      "pnpm",
      "yarn",
    ]),
    packages: z.array(
      z.string().trim().min(1)
        .max(214)
    ).min(1).max(100),
  }).strict();

export const CommandRunOperationSchema =
  z.object({
    ...BaseOperationShape,
    kind: z.literal("command.run"),
    command: z.enum([
      "bun",
      "git",
      "node",
      "npm",
      "npx",
      "pnpm",
      "yarn",
    ]),
    args: z.array(
      z.string().max(4096)
    ).max(100),
    cwd: RelativePlanPathSchema
      .optional(),
  }).strict();

export const PolicyCheckOperationSchema =
  z.object({
    ...BaseOperationShape,
    kind: z.literal("policy.check"),
    policyId:
      CanonicalIdentifierSchema,
    requirement: DescriptionSchema,
  }).strict();

export const RemoteStateChangeOperationSchema =
  z.object({
    ...BaseOperationShape,
    kind: z.literal(
      "remote-state.change"
    ),
    provider:
      CanonicalIdentifierSchema,
    resource:
      CanonicalIdentifierSchema,
    action:
      CanonicalIdentifierSchema,
    payloadSha256: DigestSchema,
  }).strict();

export const PlanOperationSchema =
  z.discriminatedUnion(
    "kind",
    [
      FileWriteOperationSchema,
      FileDeleteOperationSchema,
      DependencyChangeOperationSchema,
      CommandRunOperationSchema,
      PolicyCheckOperationSchema,
      RemoteStateChangeOperationSchema,
    ]
  );

export const OperationPlanSchema =
  z.object({
    schemaVersion:
      z.literal(
        OPERATION_PLAN_SCHEMA_VERSION
      ),
    id: z.string().regex(
      /^plan-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
      "Expected a UUID-backed plan identifier."
    ),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    projectFingerprint: DigestSchema,
    intent: CanonicalIdentifierSchema,
    summary: DescriptionSchema,
    requiresApproval: z.literal(true),
    operations: z.array(
      PlanOperationSchema
    ).min(1).max(100),
  }).strict()
    .superRefine(
      (plan, context) => {
        const createdAt =
          Date.parse(plan.createdAt);
        const expiresAt =
          Date.parse(plan.expiresAt);

        if (expiresAt <= createdAt) {
          context.addIssue({
            code:
              "custom",
            path: [
              "expiresAt",
            ],
            message:
              "Plan expiry must be later than creation time.",
          });
        }

        const operationIds =
          new Set<string>();
        const filePaths:
          string[] = [];

        for (
          const operation
          of plan.operations
        ) {
          if (
            operationIds.has(
              operation.id
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "operations",
              ],
              message:
                "Operation identifiers must be unique.",
            });
          }

          operationIds.add(
            operation.id
          );

          if (
            operation.kind ===
              "file.write" ||
            operation.kind ===
              "file.delete"
          ) {
            filePaths.push(
              normalizePlanPath(
                operation.path
              )
            );
          }
        }

        for (
          let left = 0;
          left < filePaths.length;
          left += 1
        ) {
          for (
            let right = left + 1;
            right < filePaths.length;
            right += 1
          ) {
            if (
              pathsOverlap(
                filePaths[left]!,
                filePaths[right]!
              )
            ) {
              context.addIssue({
                code: "custom",
                path: [
                  "operations",
                ],
                message:
                  "File operations must not target duplicate or overlapping paths.",
              });
            }
          }
        }

        const serialized =
          JSON.stringify(plan);

        if (
          Buffer.byteLength(
            serialized,
            "utf8"
          ) > MAX_PLAN_FILE_BYTES
        ) {
          context.addIssue({
            code: "custom",
            path: [],
            message:
              "Operation Plan v1 must not exceed 1 MiB.",
          });
        }

        if (
          redactText(serialized) !==
          serialized
        ) {
          context.addIssue({
            code: "custom",
            path: [],
            message:
              "Operation Plan v1 must not contain credentials or secret values.",
          });
        }
      }
    );

export type ExpectedFileState =
  z.infer<
    typeof ExpectedFileStateSchema
  >;

export type FileWriteOperation =
  z.infer<
    typeof FileWriteOperationSchema
  >;

export type FileDeleteOperation =
  z.infer<
    typeof FileDeleteOperationSchema
  >;

export type PlanOperation =
  z.infer<
    typeof PlanOperationSchema
  >;

export type OperationPlan =
  z.infer<
    typeof OperationPlanSchema
  >;

export function parseOperationPlan(
  value: unknown,
  source = "Operation Plan v1"
): OperationPlan {
  const result =
    OperationPlanSchema.safeParse(
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
            : "plan";

        return `${location}: ${issue.message}`;
      }
    ).join("; ");

  throw operationPlanError(
    `Invalid ${source}: ${redactText(details)}`
  );
}

export function normalizePlanPath(
  value: string
): string {
  if (!isSafeRelativePath(value)) {
    throw operationPlanError(
      "Operation paths must be safe project-relative paths."
    );
  }

  return value
    .split(/[\\/]+/u)
    .filter(
      segment =>
        segment.length > 0 &&
        segment !== "."
    )
    .join("/");
}

function isSafeRelativePath(
  value: string
): boolean {
  if (
    !value.trim() ||
    value.includes("\0") ||
    /^[\\/]/u.test(value) ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }

  const segments =
    value.split(/[\\/]+/u)
      .filter(
        segment =>
          segment.length > 0 &&
          segment !== "."
      );

  if (
    segments.length === 0 ||
    segments.includes("..")
  ) {
    return false;
  }

  const reservedWindowsName =
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

  return !segments.some(
    segment =>
      /[\u0000-\u001f]/u.test(
        segment
      ) ||
      segment.includes(":") ||
      /[. ]$/u.test(segment) ||
      reservedWindowsName.test(
        segment
      )
  );
}

function pathsOverlap(
  left: string,
  right: string
): boolean {
  const normalize =
    (value: string): string =>
      value.toLowerCase();

  const normalizedLeft =
    normalize(left);
  const normalizedRight =
    normalize(right);

  return (
    normalizedLeft ===
      normalizedRight ||
    normalizedLeft.startsWith(
      `${normalizedRight}/`
    ) ||
    normalizedRight.startsWith(
      `${normalizedLeft}/`
    )
  );
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
