export declare class OfficialRepository {
    private root;
    constructor(root?: string);
    hasPackage(packageId: string): Promise<boolean>;
    loadManifest(packageId: string): Promise<any>;
    getAllPackages(): Promise<any[]>;
}
