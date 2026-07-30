import { UninstallManager } from "./uninstallManager.js";

export async function uninstallPackage(
  packageId: string
): Promise<void> {

  const manager =
    new UninstallManager();

  await manager.uninstall(
    packageId,
    process.cwd()
  );

}