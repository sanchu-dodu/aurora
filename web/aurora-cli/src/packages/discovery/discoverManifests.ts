import fs from "fs-extra";
import path from "path";

import { loadManifest } from "../manifestLoader.js";
import { registerPackage } from "../registry/packageRegistry.js";

export async function discoverManifests(): Promise<void> {

  const packagesRoot =
    path.join(
      process.cwd(),
      "packages"
    );

  if (!(await fs.pathExists(packagesRoot))) {
    return;
  }

  const directories =
    await fs.readdir(packagesRoot);

  for (const directory of directories) {

    const manifestPath =
      path.join(
        packagesRoot,
        directory,
        "manifest.json"
      );

    if (!(await fs.pathExists(manifestPath))) {
      continue;
    }

    const manifest =
      await loadManifest(
        manifestPath
      );

    registerPackage({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
    });

  }

}