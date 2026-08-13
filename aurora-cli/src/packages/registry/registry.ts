import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  RepositoryManager,
} from "../repositories/repositoryManager.js";

export class PackageRegistry {
  private readonly repository:
    RepositoryManager;

  constructor(
    packageRoot =
      getDefaultPackageRoot()
  ) {
    this.repository =
      new RepositoryManager(
        packageRoot
      );
  }

  async getPackage(
    packageId: string
  ): Promise<PackageManifest> {
    return this.repository.getPackage(
      packageId
    );
  }

  async getAllPackages():
    Promise<PackageManifest[]> {
    return this.repository
      .getAllPackages();
  }
}
