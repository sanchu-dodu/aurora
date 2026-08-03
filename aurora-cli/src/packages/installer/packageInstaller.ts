import path from "node:path";

import { resolveDependencies } from "../dependencyResolver.js";
import { InstallerContext } from "./installerContext.js";
import { validatePackage } from "../packageValidator.js";
import { PackageRegistry } from "../registry/registry.js";
import { CompatibilityChecker } from "../compatibility/compatibilityChecker.js";
import { DependencyGraph } from "../graph/dependencyGraph.js";
import { DependencyAnalyzer } from "../graph/dependencyAnalyzer.js";
import { TopologicalSorter } from "../graph/topologicalSorter.js";
import { InstallationScheduler } from "../installation/installationScheduler.js";
import { PackageWorker } from "../installation/packageWorker.js";
import { getDefaultPackageRoot } from "../packagePaths.js";

export interface PackageInstallerOptions {
  packageRoot?: string;
  projectRoot?: string;
}

export class PackageInstaller {
  private readonly packageRoot: string;

  private readonly projectRoot: string;

  constructor(
    options: PackageInstallerOptions = {}
  ) {
    this.packageRoot =
      options.packageRoot ??
      getDefaultPackageRoot();

    this.projectRoot =
      options.projectRoot ??
      process.cwd();
  }

  async install(
    packageId: string
  ): Promise<void> {
    const packages =
      await resolveDependencies(
        packageId,
        this.packageRoot
      );

    const context =
      new InstallerContext(
        this.projectRoot
      );

    const registry =
      new PackageRegistry(
        this.packageRoot
      );

    const compatibility =
      new CompatibilityChecker();

    const dependencyGraph =
      new DependencyGraph();

    const worker =
      new PackageWorker(
        this.packageRoot
      );

    console.log("");
    console.log("Installing Packages");
    console.log("===================");
    console.log("");

    try {
      for (const packageName of packages) {
        const manifest =
          await registry.getPackage(
            packageName
          );

        validatePackage(manifest);
        compatibility.check(manifest);

        dependencyGraph.addPackage(
          manifest.id,
          manifest.dependencies ?? []
        );
      }

      const analyzer =
        new DependencyAnalyzer(
          dependencyGraph
        );

      analyzer.checkCircularDependencies();

      const sorter =
        new TopologicalSorter(
          dependencyGraph
        );

      const installationOrder =
        sorter.sort();

      console.log("");
      console.log("Installation Order");
      console.log("==================");

      for (const packageName of installationOrder) {
        console.log(packageName);
      }

      console.log("");

      const scheduler =
        new InstallationScheduler(
          dependencyGraph
        );

      const batches =
        scheduler.createBatches();

      console.log("Installation Batches");
      console.log("====================");

      batches.forEach(
        (batch, index) => {
          console.log(
            `Batch ${index + 1}: ${batch.join(", ")}`
          );
        }
      );

      console.log("");

      await context.transaction.recordModifiedFile(
        path.join(
          this.projectRoot,
          ".aurora",
          "cache.json"
        )
      );

      await context.transaction.recordModifiedFile(
        path.join(
          this.projectRoot,
          "aurora.lock"
        )
      );

      for (const batch of batches) {
        await Promise.all(
          batch.map((packageName) =>
            worker.install(
              packageName,
              context
            )
          )
        );
      }

      dependencyGraph.print();

      console.log(
        "Installation finished."
      );
    } catch (error) {
      console.log("");
      console.log(
        "Installation failed."
      );

      await context.transaction.rollback();

      throw error;
    }
  }
}
