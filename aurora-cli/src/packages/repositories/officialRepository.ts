import fs from "node:fs/promises";
import path from "node:path";

import { getDefaultPackageRoot } from "../packagePaths.js";

export class OfficialRepository {
  constructor(
    private readonly packageRoot =
      getDefaultPackageRoot()
  ) {}

  async hasPackage(
    packageId: string
  ): Promise<boolean> {
    try {
      await fs.access(
        path.join(
          this.packageRoot,
          packageId,
          "manifest.json"
        )
      );

      return true;
    } catch {
      return false;
    }
  }

  async loadManifest(
    packageId: string
  ): Promise<any> {
    const file = path.join(
      this.packageRoot,
      packageId,
      "manifest.json"
    );

    const content = await fs.readFile(
      file,
      "utf8"
    );

    return JSON.parse(content);
  }

  async getAllPackages(): Promise<any[]> {
    try {
      const folders = await fs.readdir(
        this.packageRoot,
        {
          withFileTypes: true,
        }
      );

      const packages: any[] = [];

      for (const folder of folders) {
        if (!folder.isDirectory()) {
          continue;
        }

        try {
          packages.push(
            await this.loadManifest(
              folder.name
            )
          );
        } catch {
          // Ignore invalid package directories.
        }
      }

      return packages;
    } catch {
      return [];
    }
  }
}
