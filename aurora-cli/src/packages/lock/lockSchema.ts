import {
  z,
} from "zod";

import {
  isCanonicalPackageIdentifier,
} from "../manifestSchema.js";

import {
  isPackageKeyId,
} from "../trust/packageTrustTypes.js";

import {
  isManifestSemVer,
} from "../version/manifestVersion.js";

export const PACKAGE_LOCK_MAX_BYTES =
  1024 * 1024;

export const OFFICIAL_REGISTRY_LOCK_VERSION =
  1 as const;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

const Sha256Schema =
  z.string().regex(
    SHA256_PATTERN,
    "Expected a lowercase SHA-256 digest."
  );

const PackageIdentifierSchema =
  z.string()
    .min(1)
    .max(128)
    .refine(
      isCanonicalPackageIdentifier,
      "Expected a canonical package identifier."
    );

const SemVerSchema =
  z.string()
    .min(1)
    .max(256)
    .refine(
      isManifestSemVer,
      "Expected a canonical semantic version."
    );

function isCanonicalHttpsUrl(
  value: string
): boolean {
  let parsed: URL;

  try {
    parsed =
      new URL(value);
  }
  catch {
    return false;
  }

  return (
    value.length <= 2_048 &&
    parsed.protocol === "https:" &&
    parsed.username.length === 0 &&
    parsed.password.length === 0 &&
    parsed.hash.length === 0 &&
    parsed.toString() === value
  );
}

const CanonicalHttpsUrlSchema =
  z.string().refine(
    isCanonicalHttpsUrl,
    "Expected a canonical HTTPS URL without credentials or a fragment."
  );

export const OfficialRegistryPackageLockEntrySchema =
  z.object({
    lockVersion:
      z.literal(
        OFFICIAL_REGISTRY_LOCK_VERSION
      ),

    source:
      z.literal(
        "official-registry"
      ),

    packageId:
      PackageIdentifierSchema,

    version:
      SemVerSchema,

    registry: z.object({
      sequence:
        z.number()
          .int()
          .nonnegative()
          .max(
            Number.MAX_SAFE_INTEGER
          ),

      digest:
        Sha256Schema,
    }).strict(),

    manifest: z.object({
      algorithm:
        z.literal("sha256"),

      digest:
        Sha256Schema,
    }).strict(),

    archive: z.object({
      algorithm:
        z.literal("sha256"),

      digest:
        Sha256Schema,

      size:
        z.number()
          .int()
          .positive()
          .max(
            Number.MAX_SAFE_INTEGER
          ),

      url:
        CanonicalHttpsUrlSchema,
    }).strict(),

    provenance: z.object({
      type:
        z.enum([
          "source",
          "build",
        ]),

      url:
        CanonicalHttpsUrlSchema,

      reference:
        z.string()
          .min(1)
          .max(256)
          .refine(
            value =>
              value === value.trim(),
            "Provenance reference must not contain leading or trailing whitespace."
          ),
    }).strict(),

    publisher: z.object({
      id:
        PackageIdentifierSchema,

      signatureKeyId:
        z.string()
          .refine(
            isPackageKeyId,
            "Expected a canonical package signing-key fingerprint."
          )
          .nullable(),
    }).strict(),

    packageArtifact: z.object({
      algorithm:
        z.literal("sha256"),

      digest:
        Sha256Schema,
    }).strict(),
  }).strict();

export const PackageLockEntrySchema =
  z.union([
    SemVerSchema,
    OfficialRegistryPackageLockEntrySchema,
  ]);

export const LockFileSchema =
  z.object({
    packages:
      z.record(
        z.string(),
        PackageLockEntrySchema
      ),
  })
    .strict()
    .superRefine(
      (lockFile, context) => {
        for (
          const [
            packageId,
            entry,
          ]
          of Object.entries(
            lockFile.packages
          )
        ) {
          if (
            !isCanonicalPackageIdentifier(
              packageId
            )
          ) {
            context.addIssue({
              code:
                "custom",
              path: [
                "packages",
                packageId,
              ],
              message:
                "Package-lock keys must be canonical package identifiers.",
            });
            continue;
          }

          if (
            typeof entry !== "string" &&
            entry.packageId !== packageId
          ) {
            context.addIssue({
              code:
                "custom",
              path: [
                "packages",
                packageId,
                "packageId",
              ],
              message:
                `Package-lock key '${packageId}' must match official entry id '${entry.packageId}'.`,
            });
          }
        }
      }
    );

export type OfficialRegistryPackageLockEntry =
  z.infer<
    typeof OfficialRegistryPackageLockEntrySchema
  >;

export type PackageLockEntry =
  z.infer<
    typeof PackageLockEntrySchema
  >;

export type LockFile =
  z.infer<
    typeof LockFileSchema
  >;

export function createEmptyLockFile():
  LockFile {
  return {
    packages: {},
  };
}

export function parseLockFile(
  input: unknown
): LockFile {
  return LockFileSchema.parse(
    input
  );
}

export function parseOfficialRegistryPackageLockEntry(
  input: unknown
): OfficialRegistryPackageLockEntry {
  return OfficialRegistryPackageLockEntrySchema
    .parse(input);
}

export function normalizeLockFile(
  input: LockFile
): LockFile {
  const parsed =
    parseLockFile(input);

  const packages:
    LockFile["packages"] =
      {};

  for (
    const packageId
    of Object.keys(
      parsed.packages
    ).sort()
  ) {
    packages[packageId] =
      parsed.packages[packageId];
  }

  return {
    packages,
  };
}
