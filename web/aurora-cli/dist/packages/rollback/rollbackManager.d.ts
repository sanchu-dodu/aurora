export declare class RollbackManager {
    private projectPath;
    constructor(projectPath: string);
    rollback(backupPath: string): Promise<void>;
}
