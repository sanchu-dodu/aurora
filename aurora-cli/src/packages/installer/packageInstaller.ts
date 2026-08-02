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

export class PackageInstaller {

  async install(
    packageId: string
  ): Promise<void> {

    const packages =
      await resolveDependencies(
        packageId
      );

    const context =
      new InstallerContext(
        process.cwd()
      );

    const registry =
      new PackageRegistry();

    const compatibility =
      new CompatibilityChecker();

    const dependencyGraph =
      new DependencyGraph();

    const worker =
      new PackageWorker();

    console.log();
    console.log("Installing Packages");
    console.log("===================");
    console.log();

    try {

      /*
       * Build dependency graph
       */

      for (const pkg of packages) {

        const manifest =
          await registry.getPackage(
            pkg
          );

        validatePackage(
          manifest
        );

        compatibility.check(
          manifest
        );

        dependencyGraph.addPackage(
          manifest.id,
          manifest.dependencies ?? []
        );

      }

      /*
       * Validate dependency graph
       */

      const analyzer =
        new DependencyAnalyzer(
          dependencyGraph
        );

      analyzer.checkCircularDependencies();

      /*
       * Compute installation order
       */

      const sorter =
        new TopologicalSorter(
          dependencyGraph
        );

      const installationOrder =
        sorter.sort();

      console.log();
      console.log("Installation Order");
      console.log("==================");

      for (const pkg of installationOrder) {

        console.log(pkg);

      }

      console.log();

      /*
       * Create installation batches
       */

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

      console.log();

      /*
       * Install packages
       */

      for (const batch of batches) {

  await Promise.all(

    batch.map(pkg =>
      worker.install(
        pkg,
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

      console.log();
      console.log(
        "Installation failed."
      );

      await context.transaction.rollback();

      throw error;

    }

  }

}