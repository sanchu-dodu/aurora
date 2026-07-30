export interface PipelineContext {
    projectName: string;
    framework: string;
    projectPath: string;
    packageManager: string;
    templateId: string;
    metadata: Record<string, unknown>;
}
