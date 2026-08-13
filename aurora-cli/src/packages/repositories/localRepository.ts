import type {
  PackageManifest,
} from "../manifestSchema.js";

export class LocalRepository {
  async hasPackage(
    _packageId: string
  ): Promise<boolean> {
    return false;
  }

  async loadManifest(
    _packageId: string
  ): Promise<PackageManifest> {
    throw new Error(
      "Package not found in local repository."
    );
  }

  async getAllPackages():
    Promise<PackageManifest[]> {
    return [];
  }
}
