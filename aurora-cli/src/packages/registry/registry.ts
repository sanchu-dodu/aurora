import { RepositoryManager } from "../repositories/repositoryManager.js";

export class PackageRegistry {

  private repository =
    new RepositoryManager();

  async getPackage(
    packageId: string
  ): Promise<any> {

    return this.repository.getPackage(
      packageId
    );

  }

  async getAllPackages(): Promise<any[]> {

    return this.repository.getAllPackages();

  }

}