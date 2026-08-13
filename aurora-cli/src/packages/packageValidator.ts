import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  isCanonicalPackageIdentifier,
  ManifestSchema,
  type PackageManifest,
} from "./manifestSchema.js";

export function assertCanonicalPackageIdentifier(
  identifier: string
): void {
  if (
    !isCanonicalPackageIdentifier(
      identifier
    )
  ) {
    throw new AuroraError(
      `Invalid package identifier '${identifier}'.`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Use a lowercase canonical identifier without slashes, backslashes, or traversal segments.",
      }
    );
  }
}

export function validatePackage(
  manifest: unknown,
  source = "package manifest"
): PackageManifest {
  const result =
    ManifestSchema.safeParse(
      manifest
    );

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
      `Invalid Package Manifest v1 at '${source}': ${details}`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Use the strict Package Manifest v1 schema and remove unknown fields.",
      }
    );
  }

  return result.data;
}
