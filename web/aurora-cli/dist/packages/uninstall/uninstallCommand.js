import { UninstallManager } from "./uninstallManager.js";
export async function uninstallPackage(packageId) {
    const manager = new UninstallManager();
    await manager.uninstall(packageId, process.cwd());
}
//# sourceMappingURL=uninstallCommand.js.map