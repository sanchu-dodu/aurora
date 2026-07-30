export declare class RecoveryExecutor {
    private projectPath;
    private recoveryManager;
    private rollbackManager;
    private transactionManager;
    constructor(projectPath: string);
    rollback(packageId: string): Promise<void>;
}
