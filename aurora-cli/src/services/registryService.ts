import { PackageRegistry } from "../packages/registry/registry.js";

export class RegistryService {
  private registry = new PackageRegistry();

  async discoverPackages() {
    return this.registry.getAllPackages();
  }

  async getPackage(id: string) {
    return this.registry.getPackage(id);
  }

  async search(query: string) {
    throw new Error("Not implemented");
  }

  async install(id: string) {
    throw new Error("Not implemented");
  }

  async uninstall(id: string) {
    throw new Error("Not implemented");
  }

  async update(id: string) {
    throw new Error("Not implemented");
  }

  async verify(id: string) {
    throw new Error("Not implemented");
  }

  async resolveDependencies(id: string) {
    throw new Error("Not implemented");
  }
}