import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

export async function loadInstaller(
  packageId: string
): Promise<
  ((context: any) => Promise<void>) | null
> {

  const installerPath =
    path.join(
      process.cwd(),
      "packages",
      packageId,
      "install.js"
    );


  try {

    await fs.access(
      installerPath
    );


    const module =
      await import(
        pathToFileURL(
          installerPath
        ).href
      );


    return module.install;


  } catch {

    return null;

  }

}