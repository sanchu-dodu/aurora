export declare class InitializeGitStep {
    private projectName;
    name: string;
    constructor(projectName: string);
    execute(): Promise<void>;
    rollback(): Promise<void>;
}
