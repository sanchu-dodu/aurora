import fs from "fs-extra";
import path from "node:path";

import { loadManifest } from "../manifestLoader.js";
import { registerPackage } from "../registry/packageRegistry.js";

export async function discoverManifests(): Promise<void> {
  const packagesDirectory = path.join(
    process.cwd(),
    "src",
    "packages"
  );

  if (!(await fs.pathExists(packagesDirectory))) {
    return;
  }

  const entries = await fs.readdir(
    packagesDirectory,
    {
      withFileTypes: true,
    }
  );

  const discoveredPackageIds: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestFile = path.join(
      packagesDirectory,
      entry.name,
      "manifest.json"
    );

    if (!(await fs.pathExists(manifestFile))) {
      continue;
    }

    const manifest =
      await loadManifest(manifestFile);

    registerPackage({
      id: manifest.id,
      name: manifest.id,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      framework: manifest.framework,
      category: manifest.category,
      tags: manifest.tags,
      dependencies: manifest.dependencies,
      repository: manifest.repository,
      documentation: manifest.documentation,
    });

    discoveredPackageIds.push(manifest.id);
  }

  if (discoveredPackageIds.length === 0) {
    console.log(
      "No Aurora package manifests discovered."
    );

    return;
  }

  console.log(
    `Discovered ${discoveredPackageIds.length} package manifest(s): ` +
    `${discoveredPackageIds.join(", ")}.`
  );
}
