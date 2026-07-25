export interface AuroraConfig {
  defaultFramework: string;
  language: string;
  packageManager: string;
  installDependencies: boolean;
  initializeGit: boolean;
}

export const defaultConfig: AuroraConfig = {
  defaultFramework: "nextjs",
  language: "typescript",
  packageManager: "npm",
  installDependencies: true,
  initializeGit: true,
};