import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

export async function loadInstaller(
  packageId: string
): Promise<
  ((context: any) => Promise<void>) | null
> {

  const installerPath = path.join(
    process.cwd(),
    "packages",
    packageId,
    "install.js"
  );

  console.log();
  console.log(
    `Loading installer:\n${installerPath}`
  );

  // Check if installer exists
  try {

    await fs.stat(installerPath);

  } catch {

    return null;

  }

  // Load installer
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