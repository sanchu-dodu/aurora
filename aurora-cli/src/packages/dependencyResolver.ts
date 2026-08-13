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
  satisfiesManifestVersionRange,
} from "./version/manifestVersion.js";

export async function resolveDependencies(
  packageId: string,
  packageRoot =
    getDefaultPackageRoot(),
  resolved = new Set<string>()
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

  const result: string[] = [];

  for (const dependency of manifest.dependencies) {
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
          resolved
        )
      )
    );
  }

  result.push(packageId);

  return result;
}
