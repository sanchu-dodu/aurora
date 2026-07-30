import { RepositoryManager } from "../repositories/repositoryManager.js";
export class PackageRegistry {
    repository = new RepositoryManager();
    async getPackage(packageId) {
        return this.repository.getPackage(packageId);
    }
    async getAllPackages() {
        return this.repository.getAllPackages();
    }
}
//# sourceMappingURL=registry.js.map