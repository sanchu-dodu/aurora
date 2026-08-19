import { z } from "zod";

import {
  isManifestSemVer,
} from "../version/manifestVersion.js";

export const PACKAGE_STATE_SCHEMA_VERSION =
  1 as const;

export const PACKAGE_STATE_MAX_BYTES =
  1024 * 1024;

const PACKAGE_IDENTIFIER_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

const ENVIRONMENT_NAME_PATTERN =
  /^[A-Z][A-Z0-9_]*$/u;

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

const CanonicalTimestampSchema =
  z.string()
    .refine(
      value => {
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
      value => {
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

        return segments.every(
          segment =>
            segment.length > 0 &&
            segment !== "." &&
            segment !== ".."
        );
      },
      "Expected a canonical project-relative POSIX path."
    );

const DependencyNameSchema =
  z.string()
    .trim()
    .min(1)
    .max(214)
    .refine(
      value =>
        !/\s/u.test(value) &&
        !value.includes("\0"),
      "Expected a canonical dependency name."
    );

const DependencyVersionSchema =
  z.string()
    .trim()
    .min(1)
    .max(256);

export const PackageOwnedFileSchema =
  z.object({
    path:
      RelativeProjectPathSchema,

    action:
      z.enum([
        "created",
        "modified",
      ]),

    sha256:
      Sha256Schema,

    previousSha256:
      Sha256Schema.nullable(),
  })
    .strict()
    .superRefine(
      (file, context) => {
        if (
          file.action ===
            "created" &&
          file.previousSha256 !==
            null
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "previousSha256",
            ],
            message:
              "A created file cannot declare a previous digest.",
          });
        }

        if (
          file.action ===
            "modified" &&
          file.previousSha256 ===
            null
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "previousSha256",
            ],
            message:
              "A modified file requires its previous digest.",
          });
        }
      }
    );

export const PackageOwnedDependencySchema =
  z.object({
    name:
      DependencyNameSchema,

    version:
      DependencyVersionSchema,

    previousVersion:
      DependencyVersionSchema
        .nullable(),
  }).strict();

export const PackageOwnedEnvironmentSchema =
  z.object({
    name:
      z.string()
        .regex(
          ENVIRONMENT_NAME_PATTERN,
          "Expected a canonical environment variable name."
        ),

    introduced:
      z.boolean(),
  }).strict();

export const PackageStateReceiptSchema =
  z.object({
    id:
      PackageIdentifierSchema,

    version:
      z.string()
        .refine(
          isManifestSemVer,
          "Expected a canonical semantic version."
        ),

    publisherId:
      PackageIdentifierSchema,

    artifactSha256:
      Sha256Schema,

    installedAt:
      CanonicalTimestampSchema,

    files:
      z.array(
        PackageOwnedFileSchema
      ),

    dependencies:
      z.array(
        PackageOwnedDependencySchema
      ),

    environment:
      z.array(
        PackageOwnedEnvironmentSchema
      ),
  })
    .strict()
    .superRefine(
      (receipt, context) => {
        assertUnique(
          receipt.files.map(
            file =>
              file.path.toLowerCase()
          ),
          "files",
          context
        );

        assertUnique(
          receipt.dependencies.map(
            dependency =>
              dependency.name
                .toLowerCase()
          ),
          "dependencies",
          context
        );

        assertUnique(
          receipt.environment.map(
            variable =>
              variable.name
          ),
          "environment",
          context
        );
      }
    );

const PackageMapSchema =
  z.record(
    z.string(),
    PackageStateReceiptSchema
  );

export const PackageStateSchema =
  z.object({
    schemaVersion:
      z.literal(
        PACKAGE_STATE_SCHEMA_VERSION
      ),

    packages:
      PackageMapSchema,
  })
    .strict()
    .superRefine(
      (state, context) => {
        for (
          const [
            packageId,
            receipt,
          ] of Object.entries(
            state.packages
          )
        ) {
          if (
            !PACKAGE_IDENTIFIER_PATTERN
              .test(packageId)
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "packages",
                packageId,
              ],
              message:
                "Package-state keys must be canonical package identifiers.",
            });

            continue;
          }

          if (
            receipt.id !== packageId
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "packages",
                packageId,
                "id",
              ],
              message:
                `Package-state key '${packageId}' must match receipt id '${receipt.id}'.`,
            });
          }
        }
      }
    );

export type PackageOwnedFile =
  z.infer<
    typeof PackageOwnedFileSchema
  >;

export type PackageOwnedDependency =
  z.infer<
    typeof PackageOwnedDependencySchema
  >;

export type PackageOwnedEnvironment =
  z.infer<
    typeof PackageOwnedEnvironmentSchema
  >;

export type PackageStateReceipt =
  z.infer<
    typeof PackageStateReceiptSchema
  >;

export type PackageState =
  z.infer<
    typeof PackageStateSchema
  >;

export function createEmptyPackageState():
  PackageState {
  return {
    schemaVersion:
      PACKAGE_STATE_SCHEMA_VERSION,

    packages: {},
  };
}

export function parsePackageState(
  input: unknown
): PackageState {
  return PackageStateSchema.parse(
    input
  );
}

export function parsePackageStateReceipt(
  input: unknown
): PackageStateReceipt {
  return PackageStateReceiptSchema
    .parse(input);
}

function assertUnique(
  values: readonly string[],
  field:
    | "files"
    | "dependencies"
    | "environment",
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
          `Duplicate ${field} ownership entry '${value}'.`,
      });

      continue;
    }

    seen.add(value);
  }
}