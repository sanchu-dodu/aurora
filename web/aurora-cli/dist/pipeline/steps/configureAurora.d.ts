export declare class ConfigureAuroraStep {
    private projectName;
    name: string;
    constructor(projectName: string);
    execute(): Promise<void>;
    rollback(): Promise<void>;
}
