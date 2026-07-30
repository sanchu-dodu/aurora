export interface Transaction {
    id: string;
    package: string;
    fromVersion: string;
    toVersion: string;
    status: "started" | "completed" | "failed" | "rolled_back";
    startedAt: string;
    finishedAt?: string;
    backup?: string;
}
export declare class TransactionManager {
    private projectPath;
    private folder;
    constructor(projectPath: string);
    private ensureFolder;
    create(transaction: Transaction): Promise<void>;
    update(id: string, data: Partial<Transaction>): Promise<void>;
}
