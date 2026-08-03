import path from "node:path";

import { loadInstaller } from "../installer/installerLoader.js";
import { loadHooks } from "../installer/hookLoader.js";
import { installTemplates } from "../installer/templateInstaller.js";
import type { InstallerContext } from "../installer/installerContext.js";
import { PackageRegistry } from "../registry/registry.js";
import { CacheManager } from "../cache/cacheManager.js";
import { IntegrityChecker } from "../integrity/integrityChecker.js";
import { LockManager } from "../lock/lockManager.js";
import { getDefaultPackageRoot } from "../packagePaths.js";

export class PackageWorker {
  constructor(
    private readonly packageRoot =
      getDefaultPackageRoot()
  ) {}

  async install(
    packageId: string,
    context: InstallerContext
  ): Promise<void> {
    const registry =
      new PackageRegistry(
        this.packageRoot
      );

    const cache =
      new CacheManager(
        context.getProjectPath()
      );

    const manifest =
      await registry.getPackage(
        packageId
      );

    if (
      await cache.isInstalled(packageId)
    ) {
      console.log(
        `✓ ${packageId} is already installed`
      );

      console.log("");
      return;
    }

    console.log(
      `Installing ${packageId}...`
    );

    const start =
      performance.now();

    const hooks = await loadHooks(
      packageId,
      this.packageRoot
    );

    if (hooks?.beforeInstall) {
      await hooks.beforeInstall(context);
    }

    const installer = await loadInstaller(
      packageId,
      this.packageRoot
    );

    if (installer) {
      await installer(context);

      await installTemplates(
        packageId,
        context,
        this.packageRoot
      );
    } else {
      console.log(
        "No installer found."
      );
    }

    if (hooks?.afterInstall) {
      await hooks.afterInstall(context);
    }

    const integrity =
      new IntegrityChecker();

    const checksum =
      await integrity.checksum(
        path.join(
          context.getProjectPath(),
          "package.json"
        )
      );

    await cache.install(
      packageId,
      manifest.version,
      checksum
    );

    const lock =
      new LockManager(
        context.getProjectPath()
      );

    await lock.register(
      packageId,
      manifest.version
    );

    const end =
      performance.now();

    console.log(
      `✔ Complete (${(end - start).toFixed(0)} ms)`
    );

    console.log("");
  }
}
