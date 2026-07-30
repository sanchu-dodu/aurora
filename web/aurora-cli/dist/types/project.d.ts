export interface ProjectConfig {
    projectName: string;
    framework: string;
    language: string;
    packageManager: string;
    installDependencies: boolean;
    initializeGit: boolean;
}
