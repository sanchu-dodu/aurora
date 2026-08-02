import { PackageRegistry } from "../registry/packageRegistry.js";
import type { AuroraPackage } from "../packageMetadata.js";
export class SearchService {

  private registry = new PackageRegistry();

  async search(query: string) {

    const packages =
      await this.registry.getAllPackages();

    return packages.filter(pkg =>
      pkg.name
        .toLowerCase()
        .includes(query.toLowerCase())
    );

  }

}