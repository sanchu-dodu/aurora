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

export async function loadManifest(
  file: string
): Promise<PackageManifest> {
  let content: string;

  try {
    content = await fs.readFile(
      file,
      "utf8"
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
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AuroraError(
      `Package manifest contains invalid JSON: ${file}`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Correct the JSON syntax before loading the package.",
        cause: error,
      }
    );
  }

  return validatePackage(
    parsed,
    file
  );
}
