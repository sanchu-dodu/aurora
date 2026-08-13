import fs from "node:fs/promises";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  loadManifest,
} from "../manifestLoader.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  assertCanonicalPackageIdentifier,
} from "../packageValidator.js";

export class OfficialRepository {
  private readonly boundary:
    ProjectPathBoundary;

  constructor(
    packageRoot =
      getDefaultPackageRoot()
  ) {
    this.boundary =
      new ProjectPathBoundary(
        packageRoot
      );
  }

  async hasPackage(
    packageId: string
  ): Promise<boolean> {
    assertCanonicalPackageIdentifier(
      packageId
    );

    try {
      const information =
        await fs.stat(
          this.boundary.resolve(
            `${packageId}/manifest.json`
          )
        );

      return information.isFile();
    } catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  async loadManifest(
    packageId: string
  ): Promise<PackageManifest> {
    assertCanonicalPackageIdentifier(
      packageId
    );

    const file =
      this.boundary.resolve(
        `${packageId}/manifest.json`
      );

    const manifest =
      await loadManifest(file);

    if (manifest.id !== packageId) {
      throw new AuroraError(
        `Package directory '${packageId}' contains manifest id '${manifest.id}'.`,
        {
          code:
            ErrorCodes
              .INVALID_PACKAGE_MANIFEST,
          suggestion:
            "Make the canonical manifest id match its package directory.",
        }
      );
    }

    return manifest;
  }

  async getAllPackages():
    Promise<PackageManifest[]> {
    const folders =
      await fs.readdir(
        this.boundary.projectRoot,
        {
          withFileTypes: true,
        }
      );

    const packages:
      PackageManifest[] = [];

    for (
      const folder
      of folders.sort(
        (left, right) =>
          left.name.localeCompare(
            right.name
          )
      )
    ) {
      if (!folder.isDirectory()) {
        continue;
      }

      assertCanonicalPackageIdentifier(
        folder.name
      );

      packages.push(
        await this.loadManifest(
          folder.name
        )
      );
    }

    return packages;
  }
}
