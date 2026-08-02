import { loadInstaller } from "../installer/installerLoader.js";
import { loadHooks } from "../installer/hookLoader.js";
import { installTemplates } from "../installer/templateInstaller.js";
import { InstallerContext } from "../installer/installerContext.js";
import { PackageRegistry } from "../registry/registry.js";
import { CacheManager } from "../cache/cacheManager.js";
import { IntegrityChecker } from "../integrity/integrityChecker.js";
import { LockManager } from "../lock/lockManager.js";
export class PackageWorker {

  async install(
    pkg: string,
    context: InstallerContext
  ): Promise<void> {

    const registry =
      new PackageRegistry();

    const cache =
      new CacheManager(
        context.getProjectPath()
      );

    const manifest =
      await registry.getPackage(
        pkg
      );

    if (
      await cache.isInstalled(pkg)
    ) {

      console.log(
        `✓ ${pkg} is already installed`
      );

      console.log();

      return;

    }

    console.log(
      `Installing ${pkg}...`
    );

    const start =
      performance.now();

    const hooks =
      await loadHooks(pkg);

    if (hooks?.beforeInstall) {

      await hooks.beforeInstall(
        context
      );

    }

    const installer =
      await loadInstaller(pkg);

    if (installer) {

      await installer(
        context
      );

      await installTemplates(
        pkg,
        context.getProjectPath()
      );

    } else {

      console.log(
        "No installer found."
      );

    }

    if (hooks?.afterInstall) {

      await hooks.afterInstall(
        context
      );

    }

    const integrity =
  new IntegrityChecker();

const checksum =
  await integrity.checksum(
    context.getProjectPath() +
    "/package.json"
  );

await cache.install(

  pkg,

  manifest.version,

  checksum

);

const lock =
  new LockManager(
    context.getProjectPath()
  );

await lock.register(

  pkg,

  manifest.version

);

const end =
  performance.now();

    console.log(
      `✔ Complete (${(end - start).toFixed(0)} ms)`
    );

    console.log();

  }

}