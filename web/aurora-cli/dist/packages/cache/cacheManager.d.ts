export interface CachedPackage {
    version: string;
    installedAt: string;
    checksum?: string;
    verified?: boolean;
}
export declare class CacheManager {
    private projectPath;
    private cacheFile;
    private lock;
    constructor(projectPath: string);
    private ensureCache;
    read(): Promise<Record<string, CachedPackage>>;
    write(cache: Record<string, CachedPackage>): Promise<void>;
    isInstalled(packageName: string): Promise<boolean>;
    install(packageName: string, version: string, checksum?: string): Promise<void>;
}
