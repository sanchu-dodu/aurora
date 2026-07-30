export class CommunityRepository {
    async hasPackage(packageId) {
        return false;
    }
    async loadManifest(packageId) {
        throw new Error("Package not found in community repository.");
    }
    async getAllPackages() {
        return [];
    }
}
//# sourceMappingURL=communityRepository.js.map