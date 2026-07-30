export function getPackageManager(manager) {
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
//# sourceMappingURL=packageManagerService.js.map