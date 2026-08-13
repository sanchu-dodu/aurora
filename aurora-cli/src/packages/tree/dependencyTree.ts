import { PackageRegistry } from "../registry/registry.js";

export class DependencyTree {

  private registry =
    new PackageRegistry();

  async print(
    packageId: string,
    indent = ""
  ): Promise<void> {

    const manifest =
      await this.registry.getPackage(
        packageId
      );

    console.log(
      `${indent}${packageId}`
    );

    const dependencies =
      manifest.dependencies ?? [];

    for (
      let i = 0;
      i < dependencies.length;
      i++
    ) {

      const last =
        i === dependencies.length - 1;

      const prefix =
        last
          ? "└── "
          : "├── ";

      await this.print(
        dependencies[i].id,
        indent + prefix
      );

    }

  }

}
