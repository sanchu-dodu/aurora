import { OfficialRepository } from "./officialRepository.js";
import { CommunityRepository } from "./communityRepository.js";
import { LocalRepository } from "./localRepository.js";

export class RepositoryManager {

  private repositories = [

    new OfficialRepository(),

    new CommunityRepository(),

    new LocalRepository()

  ];

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

      packages.push(
        ...manifests
      );

    }

    return packages;

  }

}