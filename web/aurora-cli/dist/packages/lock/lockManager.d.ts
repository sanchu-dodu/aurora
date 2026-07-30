export interface LockFile {
    packages: Record<string, string>;
}
export declare class LockManager {
    private projectPath;
    constructor(projectPath: string);
    private get lockFile();
    read(): Promise<LockFile>;
    write(lock: LockFile): Promise<void>;
    register(packageName: string, version: string): Promise<void>;
}
