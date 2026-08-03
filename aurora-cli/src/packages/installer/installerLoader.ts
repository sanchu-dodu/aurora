import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getDefaultPackageRoot } from "../packagePaths.js";

export async function loadInstaller(
  packageId: string,
  packageRoot = getDefaultPackageRoot()
): Promise<
  ((context: any) => Promise<void>) | null
> {
  const installerPath = path.join(
    packageRoot,
    packageId,
    "install.js"
  );

  console.log("");
  console.log(
    `Loading installer:` +
    `\n${installerPath}`
  );

  try {
    await fs.stat(installerPath);
  } catch {
    return null;
  }

  try {
    const module = await import(
      pathToFileURL(installerPath).href
    );

    return module.install;
  } catch (error) {
    console.error(
      "Failed to load installer."
    );

    throw error;
  }
}
