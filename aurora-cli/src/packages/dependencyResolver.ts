import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  getDefaultPackageRoot,
} from "./packagePaths.js";

import {
  assertCanonicalPackageIdentifier,
} from "./packageValidator.js";

import {
  OfficialRepository,
} from "./repositories/officialRepository.js";

import {
  PackageTrustPolicy,
} from "./trust/packageTrustPolicy.js";

import {
  satisfiesManifestVersionRange,
} from "./version/manifestVersion.js";

export async function resolveDependencies(
  packageId: string,
  packageRoot =
    getDefaultPackageRoot(),
  resolved = new Set<string>(),
  trustPolicy =
    new PackageTrustPolicy()
): Promise<string[]> {
  assertCanonicalPackageIdentifier(
    packageId
  );

  if (resolved.has(packageId)) {
    return [];
  }

  resolved.add(packageId);

  const repository =
    new OfficialRepository(
      packageRoot
    );

  const manifest =
    await repository.loadManifest(
      packageId
    );

  /*
   * Dependency metadata is authoritative package input.
   * Authenticate the manifest before reading dependency
   * declarations or making any resolution decision from them.
   */
  trustPolicy.verify(
    manifest
  );

  const result: string[] = [];

  for (
    const dependency
    of manifest.dependencies
  ) {
    if (
      dependency.optional &&
      !(
        await repository.hasPackage(
          dependency.id
        )
      )
    ) {
      continue;
    }

    const dependencyManifest =
      await repository.loadManifest(
        dependency.id
      );

    /*
     * Authenticate the dependency before trusting its
     * version or recursively consuming its metadata.
     */
    trustPolicy.verify(
      dependencyManifest
    );

    if (
      !satisfiesManifestVersionRange(
        dependencyManifest.version,
        dependency.version
      )
    ) {
      throw new AuroraError(
        `Package '${manifest.id}' requires '${dependency.id}' ${dependency.version}, but ${dependencyManifest.version} is available.`,
        {
          code:
            ErrorCodes
              .PACKAGE_INCOMPATIBLE,
          suggestion:
            "Install a dependency version allowed by the manifest before continuing.",
        }
      );
    }

    result.push(
      ...(
        await resolveDependencies(
          dependency.id,
          packageRoot,
          resolved,
          trustPolicy
        )
      )
    );
  }

  result.push(packageId);

  return result;
}