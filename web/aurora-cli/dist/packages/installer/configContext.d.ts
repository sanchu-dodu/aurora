import { TransactionManager } from "./transactionManager.js";
export declare class ConfigContext {
    private projectPath;
    private transaction;
    constructor(projectPath: string, transaction: TransactionManager);
    updatePackageJson(updater: (json: any) => void): Promise<void>;
    addDependency(packageName: string, version?: string): Promise<void>;
}
