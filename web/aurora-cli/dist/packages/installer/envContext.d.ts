import { TransactionManager } from "./transactionManager.js";
export declare class EnvContext {
    private projectPath;
    private transaction;
    constructor(projectPath: string, transaction: TransactionManager);
    addVariables(variables: string[]): Promise<void>;
}
