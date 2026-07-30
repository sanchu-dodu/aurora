export declare class BackupManager {
    private projectPath;
    private backupPath;
    constructor(projectPath: string);
    createBackup(): Promise<string>;
}
