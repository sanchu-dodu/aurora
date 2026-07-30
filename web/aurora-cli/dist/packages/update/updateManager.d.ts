export interface UpdateResult {
    package: string;
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    backup?: string;
    plan: {
        package: string;
        currentVersion: string;
        targetVersion: string;
    }[];
}
export declare class UpdateManager {
    private registry;
    private planner;
    check(packageId: string, projectPath: string): Promise<UpdateResult>;
    executeUpdate(packageId: string, projectPath: string, backupPath: string, currentVersion: string, targetVersion: string): Promise<void>;
}
