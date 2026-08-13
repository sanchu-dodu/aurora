import { PackageRegistry } from "../registry/registry.js";

export class DependencyInspector {

  private registry =
    new PackageRegistry();

  async findDependents(
    packageId: string
  ): Promise<string[]> {

    const packages =
      await this.registry.getAllPackages();

    const dependents: string[] = [];

    for (const pkg of packages) {

      const deps =
        pkg.dependencies ?? [];

      if (
        deps.some(
          (dependency) =>
            dependency.id ===
            packageId
        )
      ) {

        dependents.push(pkg.id);

      }

    }

    return dependents;

  }

}
