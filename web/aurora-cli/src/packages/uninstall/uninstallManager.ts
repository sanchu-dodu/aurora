import { CacheManager } from "../cache/cacheManager.js";
import { DependencyInspector } from "./dependencyInspector.js";

export class UninstallManager {

  async uninstall(
    packageId: string,
    projectPath: string
  ): Promise<void> {

    const inspector =
      new DependencyInspector();

    const dependents =
      await inspector.findDependents(
        packageId
      );

    if (dependents.length > 0) {

      console.log();

      console.log(
        "Cannot uninstall package."
      );

      console.log();

      console.log(
        "Required by:"
      );

      for (const pkg of dependents) {

        console.log(`• ${pkg}`);

      }

      console.log();

      return;

    }

    const cache =
      new CacheManager(
        projectPath
      );

    const installed =
      await cache.read();

    delete installed[packageId];

    await cache.write(installed);

    console.log();

    console.log(
      `${packageId} removed successfully.`
    );

    console.log();

  }

}