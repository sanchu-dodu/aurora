import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";
import { TransactionManager } from "./transactionManager.js";
export declare class InstallerContext {
    private projectPath;
    readonly transaction: TransactionManager;
    readonly config: ConfigContext;
    readonly env: EnvContext;
    constructor(projectPath: string);
    getProjectPath(): string;
    log(message: string): void;
    createFile(filePath: string, content: string): Promise<void>;
}
