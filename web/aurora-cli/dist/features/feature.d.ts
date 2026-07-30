export interface AuroraFeature {
    id: string;
    displayName: string;
    description: string;
    version: string;
    dependencies: string[];
    install(projectPath: string): Promise<void>;
}
