export interface AuroraConfig {
    logLevel: "info" | "debug";
    autoInstall: boolean;
    autoGit: boolean;
}
export declare function getConfig(): AuroraConfig;
