import {
  createHash,
} from "node:crypto";

import { z } from "zod";

export const LIFECYCLE_JOURNAL_SCHEMA_VERSION =
  1 as const;

export const LIFECYCLE_JOURNAL_MAX_BYTES =
  512 * 1024;

export const LIFECYCLE_JOURNAL_BLOB_MAX_BYTES =
  16 * 1024 * 1024;

export const LIFECYCLE_JOURNAL_MAX_FILES =
  4096;

export const LIFECYCLE_JOURNAL_MAX_DIRECTORIES =
  2048;

export type LifecycleJournalPhase =
  | "prepared"
  | "mutating"
  | "verifying"
  | "committed";

export type LifecycleJournalOperation =
  | "install"
  | "update"
  | "uninstall"
  | "repair";

export type LifecycleJournalFileBeforeImage =
  | {
      readonly path: string;
      readonly kind: "absent";
    }
  | {
      readonly path: string;
      readonly kind: "file";
      readonly sha256: string;
      readonly size: number;
      readonly mode: number;
    };

export type LifecycleJournalDirectoryBeforeImage =
  | {
      readonly path: string;
      readonly kind: "absent";
    }
  | {
      readonly path: string;
      readonly kind: "directory";
      readonly mode: number;
    };

export interface LifecycleJournal {
  readonly schemaVersion:
    typeof LIFECYCLE_JOURNAL_SCHEMA_VERSION;

  readonly transactionId: string;

  readonly projectRootSha256: string;

  readonly operation:
    LifecycleJournalOperation;

  readonly packageIds:
    readonly string[];

  readonly phase:
    LifecycleJournalPhase;

  readonly createdAt: string;

  readonly updatedAt: string;

  readonly files:
    readonly LifecycleJournalFileBeforeImage[];

  readonly directories:
    readonly LifecycleJournalDirectoryBeforeImage[];
}

export interface LifecycleJournalEnvelope {
  readonly digest: string;
  readonly journal:
    LifecycleJournal;
}

const PACKAGE_IDENTIFIER_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

const TRANSACTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const WINDOWS_RESERVED_NAME_PATTERN =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

const PackageIdentifierSchema =
  z.string()
    .min(1)
    .max(128)
    .regex(
      PACKAGE_IDENTIFIER_PATTERN,
      "Expected a canonical package identifier."
    );

const Sha256Schema =
  z.string()
    .regex(
      SHA256_PATTERN,
      "Expected a lowercase SHA-256 digest."
    );

const TransactionIdSchema =
  z.string()
    .regex(
      TRANSACTION_ID_PATTERN,
      "Expected a canonical UUID transaction id."
    );

const CanonicalTimestampSchema =
  z.string()
    .refine(
      (value: string) => {
        const parsed =
          new Date(value);

        return (
          !Number.isNaN(
            parsed.getTime()
          ) &&
          parsed.toISOString() ===
            value
        );
      },
      "Expected a canonical UTC ISO-8601 timestamp."
    );

const RelativeProjectPathSchema =
  z.string()
    .min(1)
    .max(512)
    .refine(
      (value: string) => {
        if (
          value.includes("\\") ||
          value.includes("\0") ||
          value.startsWith("/") ||
          /^[A-Za-z]:/u.test(value)
        ) {
          return false;
        }

        const segments =
          value.split("/");

        if (
          !segments.every(
            (segment: string) =>
              segment.length > 0 &&
              segment !== "." &&
              segment !== ".." &&
              !/[\u0000-\u001f]/u.test(
                segment
              ) &&
              !segment.includes(":") &&
              !/[. ]$/u.test(segment) &&
              !WINDOWS_RESERVED_NAME_PATTERN
                .test(segment)
          )
        ) {
          return false;
        }

        const lower =
          value.toLowerCase();

        return (
          lower !==
            ".aurora/lifecycle-journal" &&
          !lower.startsWith(
            ".aurora/lifecycle-journal/"
          )
        );
      },
      "Expected a canonical safe project-relative POSIX path outside the lifecycle journal."
    );

export const LifecycleJournalPhaseSchema =
  z.enum([
    "prepared",
    "mutating",
    "verifying",
    "committed",
  ]);

export const LifecycleJournalOperationSchema =
  z.enum([
    "install",
    "update",
    "uninstall",
    "repair",
  ]);

export const LifecycleJournalFileBeforeImageSchema =
  z.discriminatedUnion(
    "kind",
    [
      z.object({
        path:
          RelativeProjectPathSchema,

        kind:
          z.literal("absent"),
      }).strict(),

      z.object({
        path:
          RelativeProjectPathSchema,

        kind:
          z.literal("file"),

        sha256:
          Sha256Schema,

        size:
          z.number()
            .int()
            .nonnegative()
            .max(
              LIFECYCLE_JOURNAL_BLOB_MAX_BYTES
            ),

        mode:
          z.number()
            .int()
            .min(0)
            .max(0o777),
      }).strict(),
    ]
  );


export const LifecycleJournalDirectoryBeforeImageSchema =
  z.discriminatedUnion(
    "kind",
    [
      z.object({
        path:
          RelativeProjectPathSchema,

        kind:
          z.literal("absent"),
      }).strict(),

      z.object({
        path:
          RelativeProjectPathSchema,

        kind:
          z.literal("directory"),

        mode:
          z.number()
            .int()
            .min(0)
            .max(0o777),
      }).strict(),
    ]
  );

export const LifecycleJournalSchema =
  z.object({
    schemaVersion:
      z.literal(
        LIFECYCLE_JOURNAL_SCHEMA_VERSION
      ),

    transactionId:
      TransactionIdSchema,

    projectRootSha256:
      Sha256Schema,

    operation:
      LifecycleJournalOperationSchema,

    packageIds:
      z.array(
        PackageIdentifierSchema
      )
        .min(1)
        .max(256),

    phase:
      LifecycleJournalPhaseSchema,

    createdAt:
      CanonicalTimestampSchema,

    updatedAt:
      CanonicalTimestampSchema,

    files:
      z.array(
        LifecycleJournalFileBeforeImageSchema
      )
        .max(
          LIFECYCLE_JOURNAL_MAX_FILES
        ),

    directories:
      z.array(
        LifecycleJournalDirectoryBeforeImageSchema
      )
        .max(
          LIFECYCLE_JOURNAL_MAX_DIRECTORIES
        ),
  })
    .strict()
    .superRefine(
      (
        journal:
          LifecycleJournal,
        context:
          z.RefinementCtx
      ) => {
        assertUnique(
          journal.packageIds.map(
            packageId =>
              packageId.toLowerCase()
          ),
          "packageIds",
          context
        );

        assertUnique(
          journal.files.map(
            file =>
              file.path.toLowerCase()
          ),
          "files",
          context
        );

        assertUnique(
          journal.directories.map(
            directory =>
              directory.path.toLowerCase()
          ),
          "directories",
          context
        );

        if (
          new Date(
            journal.updatedAt
          ).getTime() <
          new Date(
            journal.createdAt
          ).getTime()
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "updatedAt",
            ],
            message:
              "Lifecycle journal updatedAt cannot precede createdAt.",
          });
        }
      }
    );

export const LifecycleJournalEnvelopeSchema =
  z.object({
    digest:
      Sha256Schema,

    journal:
      LifecycleJournalSchema,
  }).strict();

export function parseLifecycleJournal(
  input: unknown
): LifecycleJournal {
  return LifecycleJournalSchema.parse(
    input
  ) as LifecycleJournal;
}

export function parseLifecycleTransactionId(
  input: string
): string {
  return TransactionIdSchema.parse(
    input
  );
}

export function parseLifecycleJournalRelativePath(
  input: string
): string {
  return RelativeProjectPathSchema.parse(
    input
  );
}

export function parseLifecycleSha256(
  input: string
): string {
  return Sha256Schema.parse(
    input
  );
}

export function normalizeLifecycleJournal(
  input: unknown
): LifecycleJournal {
  const journal =
    parseLifecycleJournal(
      input
    );

  return {
    schemaVersion:
      journal.schemaVersion,

    transactionId:
      journal.transactionId,

    projectRootSha256:
      journal.projectRootSha256,

    operation:
      journal.operation,

    packageIds:
      [...journal.packageIds]
        .sort(compareText),

    phase:
      journal.phase,

    createdAt:
      journal.createdAt,

    updatedAt:
      journal.updatedAt,

    files:
      [...journal.files]
        .sort(
          (left, right) =>
            comparePath(
              left.path,
              right.path
            )
        ),

    directories:
      [...journal.directories]
        .sort(
          (left, right) =>
            comparePath(
              left.path,
              right.path
            )
        ),
  };
}

export function serializeLifecycleJournal(
  input: unknown
): string {
  const journal =
    normalizeLifecycleJournal(
      input
    );

  return `${JSON.stringify(
    journal,
    null,
    2
  )}\n`;
}

export function digestLifecycleJournal(
  input: unknown
): string {
  return createHash(
    "sha256"
  )
    .update(
      serializeLifecycleJournal(
        input
      ),
      "utf8"
    )
    .digest("hex");
}

export function createLifecycleJournalEnvelope(
  input: unknown
): LifecycleJournalEnvelope {
  const journal =
    normalizeLifecycleJournal(
      input
    );

  return {
    digest:
      digestLifecycleJournal(
        journal
      ),

    journal,
  };
}

export function serializeLifecycleJournalEnvelope(
  input: unknown
): string {
  const envelope =
    createLifecycleJournalEnvelope(
      input
    );

  return `${JSON.stringify(
    envelope,
    null,
    2
  )}\n`;
}

export function parseLifecycleJournalEnvelope(
  input: unknown
): LifecycleJournal {
  const envelope =
    LifecycleJournalEnvelopeSchema
      .parse(input);

  const journal =
    normalizeLifecycleJournal(
      envelope.journal
    );

  const expectedDigest =
    digestLifecycleJournal(
      journal
    );

  if (
    envelope.digest !==
      expectedDigest
  ) {
    throw new TypeError(
      "Lifecycle journal digest verification failed."
    );
  }

  return journal;
}

export function assertLifecycleJournalPhaseTransition(
  current:
    LifecycleJournalPhase,
  next:
    LifecycleJournalPhase
): void {
  if (current === next) {
    return;
  }

  const allowed:
    Readonly<
      Record<
        LifecycleJournalPhase,
        LifecycleJournalPhase | null
      >
    > = {
      prepared:
        "mutating",

      mutating:
        "verifying",

      verifying:
        "committed",

      committed:
        null,
    };

  if (
    allowed[current] !== next
  ) {
    throw new Error(
      `Invalid lifecycle journal phase transition '${current}' -> '${next}'.`
    );
  }
}

function assertUnique(
  values: readonly string[],
  field:
    | "packageIds"
    | "files"
    | "directories",
  context: z.RefinementCtx
): void {
  const seen =
    new Set<string>();

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    const value =
      values[index];

    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [
          field,
          index,
        ],
        message:
          `Duplicate lifecycle journal ${field} entry '${value}'.`,
      });

      continue;
    }

    seen.add(value);
  }
}

function comparePath(
  left: string,
  right: string
): number {
  const lowerComparison =
    compareText(
      left.toLowerCase(),
      right.toLowerCase()
    );

  if (lowerComparison !== 0) {
    return lowerComparison;
  }

  return compareText(
    left,
    right
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
