import type {
  PackageManifest,
} from "../manifestSchema.js";

export class CommunityRepository {
  async hasPackage(
    _packageId: string
  ): Promise<boolean> {
    return false;
  }

  async loadManifest(
    _packageId: string
  ): Promise<PackageManifest> {
    throw new Error(
      "Package not found in community repository."
    );
  }

  async getAllPackages():
    Promise<PackageManifest[]> {
    return [];
  }
}
