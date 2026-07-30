export declare class TransactionManager {
    private createdFiles;
    private modifiedFiles;
    recordCreatedFile(file: string): void;
    recordModifiedFile(file: string): Promise<void>;
    rollback(): Promise<void>;
}
