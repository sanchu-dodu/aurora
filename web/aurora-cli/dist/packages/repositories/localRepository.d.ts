export declare class LocalRepository {
    hasPackage(packageId: string): Promise<boolean>;
    loadManifest(packageId: string): Promise<any>;
    getAllPackages(): Promise<any[]>;
}
