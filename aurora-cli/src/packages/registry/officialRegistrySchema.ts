import {
  z,
} from "zod";

import {
  isCanonicalPackageIdentifier,
} from "../manifestSchema.js";

import {
  isPackageKeyId,
  isPackageSignatureValue,
  PACKAGE_SIGNATURE_VERSION,
  PACKAGE_SIGNING_ALGORITHM,
} from "../trust/packageTrustTypes.js";

import {
  compareManifestSemVer,
  isManifestSemVer,
  parseManifestSemVer,
} from "../version/manifestVersion.js";

export const OFFICIAL_REGISTRY_SCHEMA_VERSION =
  1 as const;

export const OFFICIAL_REGISTRY_KIND =
  "aurora-official-package-registry" as const;

export const OFFICIAL_REGISTRY_MAX_ENTRIES =
  10_000 as const;

export const OFFICIAL_REGISTRY_MAX_URL_LENGTH =
  2_048 as const;

export const OFFICIAL_REGISTRY_MAX_REASON_LENGTH =
  500 as const;

export const OFFICIAL_REGISTRY_MAX_REFERENCE_LENGTH =
  256 as const;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

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

const CanonicalReasonSchema =
  z.string()
    .min(1)
    .max(
      OFFICIAL_REGISTRY_MAX_REASON_LENGTH
    )
    .refine(
      (value) =>
        value === value.trim(),
      "Registry lifecycle reasons must not contain leading or trailing whitespace."
    );

const ProvenanceReferenceSchema =
  z.string()
    .min(1)
    .max(
      OFFICIAL_REGISTRY_MAX_REFERENCE_LENGTH
    )
    .refine(
      (value) =>
        value === value.trim(),
      "Registry provenance references must not contain leading or trailing whitespace."
    );

function isCanonicalHttpsUrl(
  value: string
): boolean {
  if (
    value.length === 0 ||
    value.length >
      OFFICIAL_REGISTRY_MAX_URL_LENGTH
  ) {
    return false;
  }

  let parsed: URL;

  try {
    parsed =
      new URL(value);
  }
  catch {
    return false;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    return false;
  }

  return parsed.toString() ===
    value;
}

const CanonicalHttpsUrlSchema =
  z.string()
    .max(
      OFFICIAL_REGISTRY_MAX_URL_LENGTH
    )
    .refine(
      isCanonicalHttpsUrl,
      "Expected a canonical HTTPS URL without credentials or a fragment."
    );

function isCanonicalUtcTimestamp(
  value: string
): boolean {
  const parsed =
    new Date(value);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return false;
  }

  return parsed.toISOString() ===
    value;
}

const CanonicalUtcTimestampSchema =
  z.string()
    .refine(
      isCanonicalUtcTimestamp,
      "Expected a canonical UTC ISO-8601 timestamp."
    );

export const OfficialRegistryLifecycleSchema =
  z.object({
    status:
      z.enum([
        "active",
        "revoked",
      ]),

    reason:
      CanonicalReasonSchema
        .optional(),
  })
    .strict()
    .superRefine(
      (
        lifecycle,
        context
      ) => {
        if (
          lifecycle.status ===
            "revoked" &&
          lifecycle.reason ===
            undefined
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "reason",
            ],
            message:
              "A revoked registry entry requires a reason.",
          });
        }

        if (
          lifecycle.status ===
            "active" &&
          lifecycle.reason !==
            undefined
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "reason",
            ],
            message:
              "An active registry entry cannot contain a revocation reason.",
          });
        }
      }
    );

export const OfficialRegistryArchiveSchema =
  z.object({
    algorithm:
      z.literal(
        "sha256"
      ),

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
  })
    .strict();

export const OfficialRegistryProvenanceSchema =
  z.object({
    type:
      z.enum([
        "source",
        "build",
      ]),

    url:
      CanonicalHttpsUrlSchema,

    reference:
      ProvenanceReferenceSchema,
  })
    .strict();

export const OfficialRegistryPackageEntrySchema =
  z.object({
    packageId:
      PackageIdentifierSchema,

    version:
      SemVerSchema,

    manifestDigest:
      Sha256Schema,

    archive:
      OfficialRegistryArchiveSchema,

    provenance:
      OfficialRegistryProvenanceSchema,

    lifecycle:
      OfficialRegistryLifecycleSchema,
  })
    .strict();

export const OfficialRegistrySignatureSchema =
  z.object({
    version:
      z.literal(
        PACKAGE_SIGNATURE_VERSION
      ),

    algorithm:
      z.literal(
        PACKAGE_SIGNING_ALGORITHM
      ),

    keyId:
      z.string().refine(
        isPackageKeyId,
        "Expected a lowercase SHA-256 signing-key fingerprint."
      ),

    value:
      z.string().refine(
        isPackageSignatureValue,
        "Expected a canonical 64-byte Ed25519 signature encoded as unpadded base64url."
      ),
  })
    .strict();

function compareStrings(
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

export function compareOfficialRegistryPackageEntries(
  left:
    Pick<
      OfficialRegistryPackageEntry,
      "packageId" |
      "version"
    >,
  right:
    Pick<
      OfficialRegistryPackageEntry,
      "packageId" |
      "version"
    >
): number {
  const packageComparison =
    compareStrings(
      left.packageId,
      right.packageId
    );

  if (
    packageComparison !== 0
  ) {
    return packageComparison;
  }

  const precedenceComparison =
    compareManifestSemVer(
      parseManifestSemVer(
        left.version
      ),
      parseManifestSemVer(
        right.version
      )
    );

  if (
    precedenceComparison !== 0
  ) {
    return precedenceComparison;
  }

  /*
   * SemVer build metadata does not affect precedence.
   * Use the canonical raw version as a deterministic
   * tie-breaker when two different versions have equal
   * SemVer precedence.
   */
  return compareStrings(
    left.version,
    right.version
  );
}

export const OfficialRegistrySnapshotSchema =
  z.object({
    registryVersion:
      z.literal(
        OFFICIAL_REGISTRY_SCHEMA_VERSION
      ),

    kind:
      z.literal(
        OFFICIAL_REGISTRY_KIND
      ),

    sequence:
      z.number()
        .int()
        .positive()
        .max(
          Number.MAX_SAFE_INTEGER
        ),

    publishedAt:
      CanonicalUtcTimestampSchema,

    previousSnapshotDigest:
      z.union([
        Sha256Schema,
        z.null(),
      ]),

    publisherId:
      PackageIdentifierSchema,

    packages:
      z.array(
        OfficialRegistryPackageEntrySchema
      )
        .max(
          OFFICIAL_REGISTRY_MAX_ENTRIES
        ),

    signature:
      OfficialRegistrySignatureSchema,
  })
    .strict()
    .superRefine(
      (
        snapshot,
        context
      ) => {
        if (
          snapshot.sequence === 1 &&
          snapshot.previousSnapshotDigest !==
            null
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "previousSnapshotDigest",
            ],
            message:
              "Genesis registry snapshot sequence 1 must use a null previousSnapshotDigest.",
          });
        }

        if (
          snapshot.sequence > 1 &&
          snapshot.previousSnapshotDigest ===
            null
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "previousSnapshotDigest",
            ],
            message:
              "Non-genesis registry snapshots require a previousSnapshotDigest.",
          });
        }

        const keys =
          new Set<string>();

        for (
          let index = 0;
          index <
            snapshot.packages.length;
          index += 1
        ) {
          const entry =
            snapshot.packages[
              index
            ];

          const key =
            `${entry.packageId}\0${entry.version}`;

          if (
            keys.has(key)
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "packages",
                index,
              ],
              message:
                `Duplicate registry package version '${entry.packageId}@${entry.version}'.`,
            });
          }

          keys.add(key);

          if (index === 0) {
            continue;
          }

          const previous =
            snapshot.packages[
              index - 1
            ];

          if (
            compareOfficialRegistryPackageEntries(
              previous,
              entry
            ) >= 0
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "packages",
                index,
              ],
              message:
                "Registry package entries must be strictly ordered by package id and canonical semantic version.",
            });
          }
        }
      }
    );

export type OfficialRegistryLifecycle =
  z.infer<
    typeof OfficialRegistryLifecycleSchema
  >;

export type OfficialRegistryArchive =
  z.infer<
    typeof OfficialRegistryArchiveSchema
  >;

export type OfficialRegistryProvenance =
  z.infer<
    typeof OfficialRegistryProvenanceSchema
  >;

export type OfficialRegistryPackageEntry =
  z.infer<
    typeof OfficialRegistryPackageEntrySchema
  >;

export type OfficialRegistrySignature =
  z.infer<
    typeof OfficialRegistrySignatureSchema
  >;

export type OfficialRegistrySnapshot =
  z.infer<
    typeof OfficialRegistrySnapshotSchema
  >;

export function parseOfficialRegistrySnapshot(
  value: unknown
): OfficialRegistrySnapshot {
  return OfficialRegistrySnapshotSchema
    .parse(value);
}