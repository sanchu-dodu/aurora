import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  registerPackage,
} from "../registry/packageRegistry.js";

import {
  OfficialRepository,
} from "../repositories/officialRepository.js";

export async function discoverManifests(
  packageRoot =
    getDefaultPackageRoot()
): Promise<void> {
  const manifests =
    await new OfficialRepository(
      packageRoot
    ).getAllPackages();

  for (const manifest of manifests) {
    registerPackage({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description:
        manifest.description,
      author:
        manifest.publisher.name,
      framework:
        manifest.frameworks[0] ??
        "agnostic",
      category: manifest.category,
      tags: manifest.tags,
      dependencies:
        manifest.dependencies.map(
          (dependency) =>
            dependency.id
        ),
      repository:
        manifest.links.repository,
      documentation:
        manifest.links.documentation,
    });
  }

  if (manifests.length === 0) {
    console.log(
      "No Aurora package manifests discovered."
    );

    return;
  }

  console.log(
    `Discovered ${manifests.length} package manifest(s): ` +
    `${manifests.map((manifest) => manifest.id).join(", ")}.`
  );
}
