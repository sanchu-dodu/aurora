export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export interface PackageManagerInfo {
    executable: string;
    installCommand: string[];
}
export declare function getPackageManager(manager: PackageManager): PackageManagerInfo;
