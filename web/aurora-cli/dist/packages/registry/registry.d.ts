export declare class PackageRegistry {
    private repository;
    getPackage(packageId: string): Promise<any>;
    getAllPackages(): Promise<any[]>;
}
