export declare class RepositoryManager {
    private repositories;
    getPackage(packageId: string): Promise<any>;
    getAllPackages(): Promise<any[]>;
}
