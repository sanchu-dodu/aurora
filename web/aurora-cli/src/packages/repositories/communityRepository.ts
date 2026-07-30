export class CommunityRepository {

  async hasPackage(
    packageId: string
  ): Promise<boolean> {

    return false;

  }

  async loadManifest(
    packageId: string
  ): Promise<any> {

    throw new Error(
      "Package not found in community repository."
    );

  }

  async getAllPackages(): Promise<any[]> {

    return [];

  }

}