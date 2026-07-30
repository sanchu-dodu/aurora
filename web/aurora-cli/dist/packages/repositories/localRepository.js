export class LocalRepository {
    async hasPackage(packageId) {
        return false;
    }
    async loadManifest(packageId) {
        throw new Error("Package not found in local repository.");
    }
    async getAllPackages() {
        return [];
    }
}
//# sourceMappingURL=localRepository.js.map