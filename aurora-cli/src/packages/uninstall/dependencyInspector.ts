import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  PackageRegistry,
} from "../registry/registry.js";

export class DependencyInspector {
  private readonly registry:
    PackageRegistry;

  constructor(
    packageRoot:
      string =
        getDefaultPackageRoot()
  ) {
    this.registry =
      new PackageRegistry(
        packageRoot
      );
  }

  async findDependents(
    packageId: string,
    installedPackageIds:
      readonly string[]
  ): Promise<string[]> {
    const dependents:
      string[] = [];

    /*
     * Deliberately inspect only installed package ids.
     * Merely existing in the package repository must
     * never cause an uninstalled package to block
     * removal.
     */
    for (
      const installedId
      of installedPackageIds
    ) {
      if (
        installedId ===
        packageId
      ) {
        continue;
      }

      let installedPackage;

      try {
        installedPackage =
          await this.registry
            .getPackage(
              installedId
            );
      }
      catch (error) {
        throw new Error(
          `Cannot safely determine dependencies for installed package '${installedId}' because its package manifest is unavailable.`,
          {
            cause:
              error,
          }
        );
      }

      if (
        installedPackage
          .dependencies
          .some(
            dependency =>
              dependency.id ===
              packageId
          )
      ) {
        dependents.push(
          installedId
        );
      }
    }

    return dependents
      .sort(compareText);
  }
}

function compareText(
  left: string,
  right: string
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
