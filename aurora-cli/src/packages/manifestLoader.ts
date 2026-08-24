import {
  createHash,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import type {
  Stats,
} from "node:fs";

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

export interface LoadedPackageManifestDocument {
  readonly manifest:
    PackageManifest;
  readonly sha256: string;
}

export async function loadManifestDocument(
  file: string
): Promise<
  LoadedPackageManifestDocument
> {
  let content: Buffer;
  let handle:
    fs.FileHandle |
    undefined;

  try {
    handle =
      await fs.open(
        file,
        process.platform ===
          "win32"
          ? "r"
          : fsConstants.O_RDONLY |
            fsConstants.O_NOFOLLOW
      );

    const openedInformation =
      await handle.stat();

    const pathInformation =
      await fs.lstat(file);

    if (
      pathInformation
        .isSymbolicLink() ||
      !pathInformation.isFile() ||
      !openedInformation.isFile() ||
      !sameFileIdentity(
        openedInformation,
        pathInformation
      )
    ) {
      throw new Error(
        "Package manifest path is not the same regular file that was opened."
      );
    }

    content =
      await handle.readFile();

    const completedInformation =
      await handle.stat();

    const completedPathInformation =
      await fs.lstat(file);

    if (
      !sameFileIdentity(
        openedInformation,
        completedInformation
      ) ||
      fileChangedWhileReading(
        openedInformation,
        completedInformation
      ) ||
      completedPathInformation
        .isSymbolicLink() ||
      !completedPathInformation
        .isFile() ||
      !sameFileIdentity(
        completedInformation,
        completedPathInformation
      )
    ) {
      throw new Error(
        "Package manifest changed while it was being read."
      );
    }
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
  finally {
    await handle?.close();
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

  return {
    manifest:
      validatePackage(
        parsed,
        file
      ),
    sha256:
      createHash("sha256")
        .update(content)
        .digest("hex"),
  };
}

export async function loadManifest(
  file: string
): Promise<PackageManifest> {
  return (
    await loadManifestDocument(
      file
    )
  ).manifest;
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function fileChangedWhileReading(
  before: Stats,
  after: Stats
): boolean {
  return (
    before.size !== after.size ||
    before.mtimeMs !==
      after.mtimeMs ||
    before.ctimeMs !==
      after.ctimeMs
  );
}
