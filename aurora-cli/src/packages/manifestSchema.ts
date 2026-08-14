import {
  z,
} from "zod";

import {
  isPackageKeyId,
  isPackageSignatureValue,
  PACKAGE_SIGNATURE_VERSION,
  PACKAGE_SIGNING_ALGORITHM,
} from "./trust/packageTrustTypes.js";

import {
  isManifestSemVer,
  isManifestVersionRange,
} from "./version/manifestVersion.js";

export const PACKAGE_MANIFEST_VERSION =
  1 as const;

export const PACKAGE_CAPABILITIES = [
  "aurora.commands.register",
  "host.environment.read",
  "host.secrets.read",
  "package.code.execute",
  "project.files.read",
  "project.files.write",
  "project.config.write",
  "project.dependencies.write",
  "project.environment.write",
  "process.execute",
  "network.access",
] as const;

const IDENTIFIER_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

const ENVIRONMENT_NAME_PATTERN =
  /^[A-Z][A-Z0-9_]*$/;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

const MANIFEST_PATH_PATTERN =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function isCanonicalPackageIdentifier(
  identifier: string
): boolean {
  return IDENTIFIER_PATTERN.test(
    identifier
  );
}

const PackageIdentifierSchema =
  z.string()
    .min(1)
    .max(128)
    .regex(
      IDENTIFIER_PATTERN,
      "Identifiers must use lowercase letters, numbers, dots, or hyphens and cannot contain path separators."
    );

const SemVerSchema =
  z.string().refine(
    isManifestSemVer,
    "Expected a canonical semantic version."
  );

const VersionRangeSchema =
  z.string().refine(
    isManifestVersionRange,
    "Expected a supported semantic-version range."
  );

const Sha256Schema =
  z.string().regex(
    SHA256_PATTERN,
    "Expected a lowercase SHA-256 digest."
  );

const ManifestPathSchema =
  z.string()
    .max(512)
    .regex(
      MANIFEST_PATH_PATTERN,
      "File paths must be canonical relative POSIX paths without traversal or backslashes."
    );

const HttpsUrlSchema =
  z.string().url().refine(
    (value) => {
      try {
        return new URL(value).protocol ===
          "https:";
      } catch {
        return false;
      }
    },
    "Expected an HTTPS URL."
  );

const PackageSignatureSchema =
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
        "Expected a lowercase SHA-256 public-key fingerprint."
      ),
    value:
      z.string().refine(
        isPackageSignatureValue,
        "Expected a canonical 64-byte Ed25519 signature encoded as unpadded base64url."
      ),
  }).strict();

const PackageDependencySchema =
  z.object({
    id: PackageIdentifierSchema,
    version: VersionRangeSchema,
    optional: z.boolean().default(false),
  }).strict();

const PackageConflictSchema =
  z.object({
    id: PackageIdentifierSchema,
    version: VersionRangeSchema,
    reason:
      z.string().trim()
        .min(1).max(500)
        .optional(),
  }).strict();

const PackageFileSchema =
  z.object({
    path: ManifestPathSchema,
    role: z.enum([
      "installer",
      "hook",
      "template",
      "migration",
      "asset",
    ]),
    digest: Sha256Schema,
  }).strict();

const PackageMigrationSchema =
  z.object({
    id: PackageIdentifierSchema,
    from: VersionRangeSchema,
    to: SemVerSchema,
    file: ManifestPathSchema,
  }).strict();

const PlatformSchema =
  z.object({
    os: z.array(
      z.enum([
        "any",
        "aix",
        "android",
        "darwin",
        "freebsd",
        "linux",
        "openbsd",
        "sunos",
        "win32",
      ])
    ).min(1),
    architecture: z.array(
      z.enum([
        "any",
        "arm",
        "arm64",
        "ia32",
        "loong64",
        "mips",
        "mipsel",
        "ppc",
        "ppc64",
        "riscv64",
        "s390",
        "s390x",
        "x64",
      ])
    ).min(1),
  }).strict();

const LifecycleSchema =
  z.object({
    deprecated: z.boolean(),
    revoked: z.boolean(),
    reason:
      z.string().trim()
        .min(1).max(500)
        .optional(),
    replacement:
      PackageIdentifierSchema.optional(),
  }).strict();

export const ManifestSchema =
  z.object({
    manifestVersion:
      z.literal(
        PACKAGE_MANIFEST_VERSION
      ),
    kind: z.literal("package"),
    id: PackageIdentifierSchema,
    name:
      z.string().trim()
        .min(1).max(120),
    version: SemVerSchema,
    description:
      z.string().trim()
        .min(1).max(1000),
    category:
      PackageIdentifierSchema,
    tags: z.array(
      PackageIdentifierSchema
    ).max(50),
    frameworks: z.array(
      PackageIdentifierSchema
    ).min(1).max(25),
    compatibility: z.object({
      aurora: VersionRangeSchema,
      node: VersionRangeSchema,
    }).strict(),
    publisher: z.object({
      id: PackageIdentifierSchema,
      name:
        z.string().trim()
          .min(1).max(120),
      url: HttpsUrlSchema,
    }).strict(),
    signature:
      PackageSignatureSchema
        .optional(),
    artifact: z.object({
      algorithm: z.literal("sha256"),
      digest: Sha256Schema,
    }).strict(),
    provenance: z.object({
      type: z.enum([
        "source",
        "build",
      ]),
      url: HttpsUrlSchema,
      reference:
        z.string().trim()
          .min(1).max(256),
    }).strict(),
    dependencies:
      z.array(
        PackageDependencySchema
      ),
    conflicts:
      z.array(
        PackageConflictSchema
      ),
    capabilities:
      z.array(
        z.enum(
          PACKAGE_CAPABILITIES
        )
      ),
    files:
      z.array(
        PackageFileSchema
      ),
    migrations:
      z.array(
        PackageMigrationSchema
      ),
    environment:
      z.array(
        z.object({
          name:
            z.string().regex(
              ENVIRONMENT_NAME_PATTERN
            ),
          required: z.boolean(),
          secret: z.boolean(),
        }).strict()
      ),
    platforms: PlatformSchema,
    lifecycle: LifecycleSchema,
    links: z.object({
      homepage:
        HttpsUrlSchema
          .optional(),
      repository:
        HttpsUrlSchema
          .optional(),
      documentation:
        HttpsUrlSchema
          .optional(),
    }).strict(),
  })
    .strict()
    .superRefine(
      (manifest, context) => {
        const uniqueFields: Array<
          [
            string,
            readonly string[],
          ]
        > = [
          [
            "tags",
            manifest.tags,
          ],
          [
            "frameworks",
            manifest.frameworks,
          ],
          [
            "dependencies",
            manifest.dependencies.map(
              (dependency) =>
                dependency.id
            ),
          ],
          [
            "conflicts",
            manifest.conflicts.map(
              (conflict) =>
                conflict.id
            ),
          ],
          [
            "capabilities",
            manifest.capabilities,
          ],
          [
            "files",
            manifest.files.map(
              (file) => file.path
            ),
          ],
          [
            "migrations",
            manifest.migrations.map(
              (migration) =>
                migration.id
            ),
          ],
          [
            "environment",
            manifest.environment.map(
              (variable) =>
                variable.name
            ),
          ],
          [
            "platforms.os",
            manifest.platforms.os,
          ],
          [
            "platforms.architecture",
            manifest.platforms
              .architecture,
          ],
        ];

        for (const [field, values] of uniqueFields) {
          if (
            new Set(values).size !==
            values.length
          ) {
            context.addIssue({
              code: "custom",
              path: field.split("."),
              message:
                `${field} cannot contain duplicate values.`,
            });
          }
        }

        if (
          manifest.dependencies.some(
            (dependency) =>
              dependency.id === manifest.id
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["dependencies"],
            message:
              "A package cannot depend on itself.",
          });
        }

        if (
          manifest.conflicts.some(
            (conflict) =>
              conflict.id === manifest.id
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["conflicts"],
            message:
              "A package cannot conflict with itself.",
          });
        }

        const dependencyIds =
          new Set(
            manifest.dependencies.map(
              (dependency) =>
                dependency.id
            )
          );

        for (const conflict of manifest.conflicts) {
          if (
            dependencyIds.has(
              conflict.id
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["conflicts"],
              message:
                `Package '${conflict.id}' cannot be both a dependency and a conflict.`,
            });
          }
        }

        const declaredFiles =
          new Map(
            manifest.files.map(
              (file) => [
                file.path,
                file.role,
              ]
            )
          );

        for (const migration of manifest.migrations) {
          if (
            declaredFiles.get(
              migration.file
            ) !== "migration"
          ) {
            context.addIssue({
              code: "custom",
              path: ["migrations"],
              message:
                `Migration '${migration.id}' must reference a declared migration file.`,
            });
          }
        }

        for (const role of [
          "installer",
          "hook",
        ] as const) {
          if (
            manifest.files.filter(
              (file) =>
                file.role === role
            ).length > 1
          ) {
            context.addIssue({
              code: "custom",
              path: ["files"],
              message:
                `Only one ${role} file may be declared.`,
            });
          }
        }

        for (const file of manifest.files) {
          if (
            (
              file.role === "installer" ||
              file.role === "hook" ||
              file.role === "migration"
            ) &&
            !file.path.endsWith(".js")
          ) {
            context.addIssue({
              code: "custom",
              path: ["files"],
              message:
                "Executable package files must use the .js extension.",
            });
          }

          if (
            file.role === "hook" &&
            !file.path.startsWith(
              "hooks/"
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["files"],
              message:
                "Hook files must be declared below hooks/.",
            });
          }

          if (
            file.role === "migration" &&
            !file.path.startsWith(
              "migrations/"
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["files"],
              message:
                "Migration files must be declared below migrations/.",
            });
          }

          if (
            file.role === "template" &&
            (
              !file.path.startsWith(
                "templates/"
              ) ||
              !file.path.endsWith(
                ".template"
              )
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["files"],
              message:
                "Template files must be declared below templates/ and end in .template.",
            });
          }
        }

        const capabilitySet =
          new Set(
            manifest.capabilities
          );

        if (
          manifest.files.some(
            (file) =>
              file.role === "installer" ||
              file.role === "hook" ||
              file.role === "migration"
          ) &&
          !capabilitySet.has(
            "package.code.execute"
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["capabilities"],
            message:
              "Executable package files require the package.code.execute capability.",
          });
        }

        if (
          manifest.files.some(
            (file) =>
              file.role === "template"
          ) &&
          !capabilitySet.has(
            "project.files.write"
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["capabilities"],
            message:
              "Template files require the project.files.write capability.",
          });
        }

        if (
          manifest.environment.length > 0 &&
          !capabilitySet.has(
            "project.environment.write"
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["capabilities"],
            message:
              "Environment declarations require the project.environment.write capability.",
          });
        }

        for (const field of [
          manifest.platforms.os,
          manifest.platforms.architecture,
        ]) {
          if (
            field.includes("any") &&
            field.length > 1
          ) {
            context.addIssue({
              code: "custom",
              path: ["platforms"],
              message:
                "The 'any' platform value cannot be combined with specific values.",
            });
          }
        }

        if (
          (
            manifest.lifecycle.deprecated ||
            manifest.lifecycle.revoked
          ) &&
          !manifest.lifecycle.reason
        ) {
          context.addIssue({
            code: "custom",
            path: ["lifecycle", "reason"],
            message:
              "Deprecated or revoked packages require a reason.",
          });
        }

        if (
          manifest.lifecycle.replacement ===
          manifest.id
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "lifecycle",
              "replacement",
            ],
            message:
              "A package cannot replace itself.",
          });
        }
      }
    );

export type PackageManifest =
  z.infer<typeof ManifestSchema>;
