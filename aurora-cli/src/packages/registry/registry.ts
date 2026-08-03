import { RepositoryManager } from "../repositories/repositoryManager.js";
import { getDefaultPackageRoot } from "../packagePaths.js";

export class PackageRegistry {
  private readonly repository: RepositoryManager;

  constructor(
    packageRoot = getDefaultPackageRoot()
  ) {
    this.repository =
      new RepositoryManager(packageRoot);
  }

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
