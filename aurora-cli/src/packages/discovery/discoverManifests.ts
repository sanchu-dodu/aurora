import fs from "fs-extra";
import path from "path";

import { loadManifest } from "../manifestLoader.js";
import { registerPackage } from "../registry/packageRegistry.js";

export async function discoverManifests(): Promise<void> {

  console.log("Running discoverManifests...");

  const packagesDirectory = path.join(
    process.cwd(),
    "src",
    "packages"
  );

  console.log("Looking in:", packagesDirectory);

  if (!(await fs.pathExists(packagesDirectory))) {
    return;
  }

  const entries = await fs.readdir(packagesDirectory);

  console.log("Entries:", entries);

  for (const entry of entries) {

    console.log("Checking:", entry);

    const manifestFile = path.join(
      packagesDirectory,
      entry,
      "manifest.json"
    );

    console.log("Manifest:", manifestFile);

    console.log(
      "Exists:",
      await fs.pathExists(manifestFile)
    );

    if (!(await fs.pathExists(manifestFile))) {
      continue;
    }

    const manifest = await loadManifest(manifestFile);

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

    console.log(`✔ Registered package: ${manifest.id}`);
  }
}