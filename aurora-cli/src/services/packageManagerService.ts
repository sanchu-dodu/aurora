export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun";

export interface PackageManagerInfo {
  executable: string;
  installCommand: string[];
}

export function getPackageManager(
  manager: PackageManager
): PackageManagerInfo {

  switch (manager) {

    case "pnpm":
      return {
        executable: "pnpm",
        installCommand: ["install"],
      };

    case "yarn":
      return {
        executable: "yarn",
        installCommand: [],
      };

    case "bun":
      return {
        executable: "bun",
        installCommand: ["install"],
      };

    default:
      return {
        executable: "npm",
        installCommand: ["install"],
      };

  }

}