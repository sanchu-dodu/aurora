import fs from "node:fs/promises";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import type {
  PackageManifest,
} from "./manifestSchema.js";

import {
  validatePackage,
} from "./packageValidator.js";

import {
  parsePackageManifestBytes,
} from "./trust/packageManifestJson.js";

export async function loadManifest(
  file: string
): Promise<PackageManifest> {
  let content: Buffer;

  try {
    content =
      await fs.readFile(
        file
      );
  } catch (error) {
    throw new AuroraError(
      `Package manifest could not be read: ${file}`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Confirm the manifest exists and is readable.",
        cause: error,
      }
    );
  }

  let parsed: unknown;

  try {
    parsed =
      parsePackageManifestBytes(
        content
      );
  } catch (error) {
    throw new AuroraError(
      `Package manifest contains invalid or ambiguous JSON: ${file}`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Use canonical unambiguous JSON without duplicate properties, malformed Unicode, excessive depth, or invalid numeric values.",
        cause: error,
      }
    );
  }

  return validatePackage(
    parsed,
    file
  );
}
