export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun";

export interface PackageManagerInfo {
  executable: PackageManager;
  installCommand: string[];
  lockFiles: string[];
}

export function getPackageManager(
  manager: string
): PackageManagerInfo {

  switch (manager) {

    case "pnpm":
      return {
        executable: "pnpm",
        installCommand: ["install"],
        lockFiles: [
          "pnpm-lock.yaml",
        ],
      };

    case "yarn":
      return {
        executable: "yarn",
        installCommand: [],
        lockFiles: [
          "yarn.lock",
        ],
      };

    case "bun":
      return {
        executable: "bun",
        installCommand: ["install"],
        lockFiles: [
          "bun.lock",
          "bun.lockb",
        ],
      };

    case "npm":
      return {
        executable: "npm",
        installCommand: ["install"],
        lockFiles: [
          "package-lock.json",
          "npm-shrinkwrap.json",
        ],
      };

    default:
      throw new Error(
        `Unsupported package manager: ${manager}`
      );

  }

}
