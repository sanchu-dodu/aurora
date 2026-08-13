import crypto from "node:crypto";
import fs from "node:fs/promises";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  redactText,
} from "../../security/secretRedactor.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  IntegrityChecker,
} from "./integrityChecker.js";

type DeclaredFile =
  PackageManifest["files"][number];

export function calculateArtifactDigest(
  files: readonly Pick<
    DeclaredFile,
    "path" | "digest"
  >[]
): string {
  const inventory = files
    .map((file) => ({
      path: file.path,
      digest: file.digest,
    }))
    .sort(
      (left, right) => {
        if (left.path < right.path) {
          return -1;
        }

        if (left.path > right.path) {
          return 1;
        }

        return 0;
      }
    )
    .map(
      (file) =>
        `${file.path}\0${file.digest}`
    )
    .join("\n");

  return crypto
    .createHash("sha256")
    .update(inventory)
    .digest("hex");
}

function integrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' failed artifact verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Restore the package from a trusted source and verify its Manifest v1 digests.",
      cause,
    }
  );
}

async function collectArtifactFiles(
  boundary: ProjectPathBoundary,
  directory: string,
  relativeDirectory = ""
): Promise<string[]> {
  const entries = await fs.readdir(
    directory,
    {
      withFileTypes: true,
    }
  );

  const files: string[] = [];

  for (const entry of entries) {
    const relativePath =
      relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;

    const absolutePath =
      boundary.resolve(
        relativePath
      );

    const information =
      await fs.lstat(absolutePath);

    if (information.isSymbolicLink()) {
      throw new Error(
        `Artifact path is a symbolic link or junction: ${relativePath}`
      );
    }

    if (information.isDirectory()) {
      files.push(
        ...(
          await collectArtifactFiles(
            boundary,
            absolutePath,
            relativePath
          )
        )
      );

      continue;
    }

    if (!information.isFile()) {
      throw new Error(
        `Artifact path is not a regular file: ${relativePath}`
      );
    }

    if (relativePath !== "manifest.json") {
      files.push(relativePath);
    }
  }

  return files;
}

export class PackageArtifactVerifier {
  async verify(
    packageRoot: string,
    manifest: PackageManifest
  ): Promise<void> {
    try {
      const rootBoundary =
        new ProjectPathBoundary(
          packageRoot
        );

      const packageDirectory =
        rootBoundary.resolve(
          manifest.id
        );

      const packageBoundary =
        new ProjectPathBoundary(
          packageDirectory
        );

      const actualFiles =
        (
          await collectArtifactFiles(
            packageBoundary,
            packageBoundary.projectRoot
          )
        ).sort();

      const declaredFiles =
        manifest.files
          .map((file) => file.path)
          .sort();

      if (
        actualFiles.length !==
          declaredFiles.length ||
        actualFiles.some(
          (file, index) =>
            file !== declaredFiles[index]
        )
      ) {
        throw new Error(
          `Declared files [${declaredFiles.join(", ")}] do not match artifact files [${actualFiles.join(", ")}].`
        );
      }

      const checker =
        new IntegrityChecker();

      for (const file of manifest.files) {
        const actualDigest =
          await checker.checksum(
            packageBoundary.resolve(
              file.path
            )
          );

        if (
          !checker.verify(
            file.digest,
            actualDigest
          )
        ) {
          throw new Error(
            `Digest mismatch for '${file.path}'.`
          );
        }
      }

      const artifactDigest =
        calculateArtifactDigest(
          manifest.files
        );

      if (
        artifactDigest !==
        manifest.artifact.digest
      ) {
        throw new Error(
          "The aggregate artifact digest does not match the declared file inventory."
        );
      }
    } catch (error) {
      if (
        error instanceof AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
      ) {
        throw error;
      }

      throw integrityFailure(
        manifest.id,
        redactText(
          error instanceof Error
            ? error.message
            : String(error)
        ),
        error
      );
    }
  }
}
