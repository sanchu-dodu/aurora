export declare class CommunityRepository {
    hasPackage(packageId: string): Promise<boolean>;
    loadManifest(packageId: string): Promise<any>;
    getAllPackages(): Promise<any[]>;
}
