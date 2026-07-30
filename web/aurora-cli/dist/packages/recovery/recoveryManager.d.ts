export interface RecoveryTransaction {
    id: string;
    package: string;
    fromVersion: string;
    toVersion: string;
    status: string;
    backup?: string;
}
export declare class RecoveryManager {
    private projectPath;
    private folder;
    constructor(projectPath: string);
    findIncomplete(): Promise<RecoveryTransaction[]>;
}
