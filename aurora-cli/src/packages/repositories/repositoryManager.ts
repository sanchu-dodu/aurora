import { OfficialRepository } from "./officialRepository.js";
import { CommunityRepository } from "./communityRepository.js";
import { LocalRepository } from "./localRepository.js";
import { getDefaultPackageRoot } from "../packagePaths.js";

export class RepositoryManager {
  private readonly repositories;

  constructor(
    packageRoot = getDefaultPackageRoot()
  ) {
    this.repositories = [
      new OfficialRepository(packageRoot),
      new CommunityRepository(),
      new LocalRepository(),
    ];
  }

  async getPackage(
    packageId: string
  ): Promise<any> {
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

  async getAllPackages(): Promise<any[]> {
    const packages: any[] = [];

    for (const repository of this.repositories) {
      const manifests =
        await repository.getAllPackages();

      packages.push(...manifests);
    }

    return packages;
  }
}
