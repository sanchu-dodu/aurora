import fs from "fs-extra";

import { PackageManifest } from "./packageManifest.js";

export async function loadManifest(
  file: string
): Promise<PackageManifest> {

  const content =
    await fs.readFile(
      file,
      "utf8"
    );

  return JSON.parse(
    content
  ) as PackageManifest;

}