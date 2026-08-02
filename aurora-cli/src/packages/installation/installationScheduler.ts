import { DependencyGraph } from "../graph/dependencyGraph.js";

export class InstallationScheduler {
  constructor(
    private readonly dependencyGraph: DependencyGraph
  ) {}

  createBatches(): string[][] {
    const packages = this.collectPackages();
    const remaining = new Set<string>(packages);
    const completed = new Set<string>();
    const batches: string[][] = [];

    while (remaining.size > 0) {
      const batch = packages.filter((packageId) => {
        if (!remaining.has(packageId)) {
          return false;
        }

        const dependencies =
          this.dependencyGraph.getDependencies(packageId);

        return dependencies.every((dependencyId) =>
          completed.has(dependencyId)
        );
      });

      if (batch.length === 0) {
        const unresolved = Array.from(remaining).join(", ");

        throw new Error(
          `Unable to schedule installation. Unresolved packages: ${unresolved}`
        );
      }

      batches.push(batch);

      for (const packageId of batch) {
        remaining.delete(packageId);
        completed.add(packageId);
      }
    }

    return batches;
  }

  private collectPackages(): string[] {
    const packages = new Set<string>();

    for (const packageId of this.dependencyGraph.getPackages()) {
      this.collectPackageAndDependencies(packageId, packages);
    }

    return Array.from(packages);
  }

  private collectPackageAndDependencies(
    packageId: string,
    packages: Set<string>
  ): void {
    if (packages.has(packageId)) {
      return;
    }

    for (
      const dependencyId of
      this.dependencyGraph.getDependencies(packageId)
    ) {
      this.collectPackageAndDependencies(
        dependencyId,
        packages
      );
    }

    packages.add(packageId);
  }
}
