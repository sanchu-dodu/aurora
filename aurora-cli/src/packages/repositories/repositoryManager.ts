import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  assertCanonicalPackageIdentifier,
} from "../packageValidator.js";

import {
  CommunityRepository,
} from "./communityRepository.js";

import {
  LocalRepository,
} from "./localRepository.js";

import {
  OfficialRepository,
} from "./officialRepository.js";

interface PackageRepository {
  hasPackage(
    packageId: string
  ): Promise<boolean>;

  loadManifest(
    packageId: string
  ): Promise<PackageManifest>;

  getAllPackages():
    Promise<PackageManifest[]>;
}

export class RepositoryManager {
  private readonly repositories:
    PackageRepository[];

  constructor(
    packageRoot =
      getDefaultPackageRoot()
  ) {
    this.repositories = [
      new OfficialRepository(
        packageRoot
      ),
      new CommunityRepository(),
      new LocalRepository(),
    ];
  }

  async getPackage(
    packageId: string
  ): Promise<PackageManifest> {
    assertCanonicalPackageIdentifier(
      packageId
    );

    for (const repository of this.repositories) {
      if (
        await repository.hasPackage(
          packageId
        )
      ) {
        return repository.loadManifest(
          packageId
        );
      }
    }

    throw new Error(
      `Package '${packageId}' was not found in any repository.`
    );
  }

  async getAllPackages():
    Promise<PackageManifest[]> {
    const packages:
      PackageManifest[] = [];

    for (const repository of this.repositories) {
      packages.push(
        ...(
          await repository
            .getAllPackages()
        )
      );
    }

    return packages;
  }
}
