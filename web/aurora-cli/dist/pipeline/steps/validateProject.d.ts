export declare class ValidateProjectStep {
    private projectPath;
    name: string;
    constructor(projectPath: string);
    execute(): Promise<void>;
}
