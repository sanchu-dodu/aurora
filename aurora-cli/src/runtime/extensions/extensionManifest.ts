import {
  z,
} from "zod";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  isManifestSemVer,
} from "../../packages/version/manifestVersion.js";

export const EXTENSION_MANIFEST_VERSION =
  1 as const;

export const EXTENSION_CAPABILITIES = [
  "aurora.output.write",
  "host.environment.read",
  "network.access",
  "process.execute",
  "project.files.read",
  "project.files.write",
] as const;

export type ExtensionCapability =
  typeof EXTENSION_CAPABILITIES[number];

const IDENTIFIER_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

const ENTRY_PATTERN =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.js$/;

const ExtensionManifestSchema =
  z.object({
    manifestVersion:
      z.literal(
        EXTENSION_MANIFEST_VERSION
      ),
    kind: z.literal("extension"),
    id: z.string()
      .min(1).max(128)
      .regex(
        IDENTIFIER_PATTERN,
        "Extension identifiers must be canonical lowercase values."
      ),
    name: z.string().trim()
      .min(1).max(120),
    version: z.string().refine(
      isManifestSemVer,
      "Expected a canonical semantic version."
    ),
    entry: z.string()
      .max(512)
      .regex(
        ENTRY_PATTERN,
        "Extension entry must be a canonical relative JavaScript path."
      ),
    trust: z.enum([
      "built-in",
      "verified",
      "community",
      "local-development",
    ]),
    capabilities:
      z.array(
        z.enum(
          EXTENSION_CAPABILITIES
        )
      ).max(
        EXTENSION_CAPABILITIES.length
      ),
    limits: z.object({
      timeoutMs:
        z.number().int()
          .min(100).max(30_000),
      maxOldGenerationSizeMb:
        z.number().int()
          .min(16).max(256),
      maxOutputBytes:
        z.number().int()
          .min(256)
          .max(1024 * 1024),
    }).strict(),
  })
    .strict()
    .superRefine(
      (manifest, context) => {
        if (
          new Set(
            manifest.capabilities
          ).size !==
          manifest.capabilities.length
        ) {
          context.addIssue({
            code: "custom",
            path: ["capabilities"],
            message:
              "Extension capabilities cannot contain duplicates.",
          });
        }
      }
    );

export type ExtensionManifest =
  z.infer<
    typeof ExtensionManifestSchema
  >;

export function validateExtensionManifest(
  manifest: unknown,
  source = "extension manifest"
): ExtensionManifest {
  const result =
    ExtensionManifestSchema
      .safeParse(manifest);

  if (!result.success) {
    const details =
      result.error.issues
        .map((issue) => {
          const location =
            issue.path.length > 0
              ? issue.path.join(".")
              : "manifest";

          return `${location}: ${issue.message}`;
        })
        .join("; ");

    throw new AuroraError(
      `Invalid Extension Manifest v1 at '${source}': ${details}`,
      {
        code:
          ErrorCodes
            .INVALID_EXTENSION_MANIFEST,
        suggestion:
          "Use the strict Extension Manifest v1 contract and remove unknown fields.",
      }
    );
  }

  return result.data;
}
