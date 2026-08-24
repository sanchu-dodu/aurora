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
  PackageArtifactVerifier,
} from "../integrity/packageArtifactVerifier.js";

import {
  loadManifestDocument,
} from "../manifestLoader.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  assertLockedOfficialRegistryPackage,
} from "./officialRegistryPackageLocker.js";

import type {
  LockedOfficialRegistryPackage,
} from "./officialRegistryPackageLocker.js";

function installIdentityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' installation identity failed verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Reject the installation and repeat resolution, acquisition, caching, extraction, and locking from trusted inputs.",
      cause,
    }
  );
}

export async function loadVerifiedLockedOfficialRegistryManifest(
  locked:
    LockedOfficialRegistryPackage,
  packageRoot: string,
  projectRoot: string
): Promise<PackageManifest> {
  assertLockedOfficialRegistryPackage(
    locked
  );

  const packageId =
    locked.entry.packageId;

  try {
    const canonicalProjectRoot =
      new ProjectPathBoundary(
        projectRoot
      ).projectRoot;

    if (
      canonicalProjectRoot !==
        locked.projectRoot
    ) {
      throw installIdentityFailure(
        packageId,
        "the verified lock receipt belongs to a different project."
      );
    }

    const packageBoundary =
      new ProjectPathBoundary(
        packageRoot
      );

    if (
      packageBoundary.projectRoot !==
        locked.extracted
          .stagingPath
    ) {
      throw installIdentityFailure(
        packageId,
        "the installer package root is not the authenticated extraction staging root."
      );
    }

    const manifestPath =
      packageBoundary.resolve(
        `${packageId}/manifest.json`
      );

    if (
      manifestPath !==
        locked.extracted
          .manifestPath
    ) {
      throw installIdentityFailure(
        packageId,
        "the installer manifest path is not the authenticated extraction manifest path."
      );
    }

    const document =
      await loadManifestDocument(
        manifestPath
      );

    const manifest =
      document.manifest;

    if (
      document.sha256 !==
        locked.entry
          .manifest.digest
    ) {
      throw installIdentityFailure(
        packageId,
        "manifest.json does not match the exact digest authenticated by the official registry lock."
      );
    }

    if (
      manifest.id !== packageId ||
      manifest.version !==
        locked.entry.version ||
      manifest.publisher.id !==
        locked.entry
          .publisher.id ||
      (
        manifest.signature
          ?.keyId ??
        null
      ) !==
        locked.entry
          .publisher
          .signatureKeyId ||
      manifest.artifact.algorithm !==
        locked.entry
          .packageArtifact
          .algorithm ||
      manifest.artifact.digest !==
        locked.entry
          .packageArtifact
          .digest
    ) {
      throw installIdentityFailure(
        packageId,
        "manifest identity, publisher, signing key, or artifact digest does not match the authenticated lock entry."
      );
    }

    await new PackageArtifactVerifier()
      .verify(
        packageBoundary
          .projectRoot,
        manifest
      );

    return manifest;
  }
  catch (error) {
    if (
      error instanceof AuroraError &&
      error.code ===
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED
    ) {
      throw error;
    }

    throw installIdentityFailure(
      packageId,
      "the locked extraction could not be safely revalidated before installation.",
      error
    );
  }
}
