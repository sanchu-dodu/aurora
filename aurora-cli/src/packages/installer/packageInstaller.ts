import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  CacheManager,
} from "../cache/cacheManager.js";

import {
  CompatibilityChecker,
} from "../compatibility/compatibilityChecker.js";

import {
  resolveDependencies,
} from "../dependencyResolver.js";

import {
  DependencyAnalyzer,
} from "../graph/dependencyAnalyzer.js";

import {
  DependencyGraph,
} from "../graph/dependencyGraph.js";

import {
  PackageArtifactVerifier,
} from "../integrity/packageArtifactVerifier.js";

import {
  InstallationScheduler,
} from "../installation/installationScheduler.js";

import {
  PackageWorker,
} from "../installation/packageWorker.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  PackageRegistry,
} from "../registry/registry.js";

import {
  PackageTrustPolicy,
  type PackageTrustPolicyOptions,
} from "../trust/packageTrustPolicy.js";

import {
  TopologicalSorter,
} from "../graph/topologicalSorter.js";

import {
  satisfiesManifestVersionRange,
} from "../version/manifestVersion.js";

import {
  InstallerContext,
} from "./installerContext.js";

export interface PackageInstallerOptions {
  packageRoot?: string;
  projectRoot?: string;

  trust?:
    PackageTrustPolicyOptions;
}

function checkConflicts(
  manifests: ReadonlyMap<
    string,
    PackageManifest
  >,
  installed: Readonly<
    Record<
      string,
      {
        version: string;
      }
    >
  >
): void {
  for (const manifest of manifests.values()) {
    for (const conflict of manifest.conflicts) {
      const candidateVersion =
        manifests.get(
          conflict.id
        )?.version ??
        installed[conflict.id]
          ?.version;

      if (
        candidateVersion &&
        satisfiesManifestVersionRange(
          candidateVersion,
          conflict.version
        )
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' conflicts with '${conflict.id}' ${candidateVersion}.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INCOMPATIBLE,
            suggestion:
              conflict.reason ??
              "Remove the conflicting package before continuing.",
          }
        );
      }
    }
  }
}

export class PackageInstaller {
  private readonly packageRoot:
    string;

  private readonly projectRoot:
    string;

  private readonly trustPolicy:
    PackageTrustPolicy;

  constructor(
    options:
      PackageInstallerOptions = {}
  ) {
    this.packageRoot =
      options.packageRoot ??
      getDefaultPackageRoot();

    this.projectRoot =
      options.projectRoot ??
      process.cwd();

    this.trustPolicy =
      new PackageTrustPolicy(
        options.trust
      );
  }

  async install(
    packageId: string
  ): Promise<void> {
    const packages =
      await resolveDependencies(
        packageId,
        this.packageRoot,
        new Set<string>(),
        this.trustPolicy
      );

    const registry =
      new PackageRegistry(
        this.packageRoot
      );

    const compatibility =
      new CompatibilityChecker();

    const verifier =
      new PackageArtifactVerifier();

    const dependencyGraph =
      new DependencyGraph();

    const manifests =
      new Map<
        string,
        PackageManifest
      >();

    console.log("");
    console.log(
      "Installing Packages"
    );
    console.log(
      "==================="
    );
    console.log("");

    for (const packageName of packages) {
      const manifest =
        await registry.getPackage(
          packageName
        );

      /*
       * Authenticate publisher authority before
       * trusting any manifest-controlled package
       * metadata during installation preflight.
       */
      this.trustPolicy.verify(
        manifest
      );

      compatibility.check(
        manifest
      );

      await verifier.verify(
        this.packageRoot,
        manifest
      );

      manifests.set(
        manifest.id,
        manifest
      );

      dependencyGraph.addPackage(
        manifest.id,
        manifest.dependencies
          .filter(
            (dependency) =>
              packages.includes(
                dependency.id
              )
          )
          .map(
            (dependency) =>
              dependency.id
          )
      );
    }

    const installed =
      await new CacheManager(
        this.projectRoot
      ).readExisting();

    checkConflicts(
      manifests,
      installed
    );

    const analyzer =
      new DependencyAnalyzer(
        dependencyGraph
      );

    analyzer
      .checkCircularDependencies();

    const sorter =
      new TopologicalSorter(
        dependencyGraph
      );

    const installationOrder =
      sorter.sort();

    console.log("");
    console.log(
      "Installation Order"
    );
    console.log(
      "=================="
    );

    for (
      const packageName
      of installationOrder
    ) {
      console.log(packageName);
    }

    console.log("");

    const scheduler =
      new InstallationScheduler(
        dependencyGraph
      );

    const batches =
      scheduler.createBatches();

    console.log(
      "Installation Batches"
    );
    console.log(
      "===================="
    );

    batches.forEach(
      (batch, index) => {
        console.log(
          `Batch ${index + 1}: ${batch.join(", ")}`
        );
      }
    );

    console.log("");

    const context =
      new InstallerContext(
        this.projectRoot
      );

    const worker =
      new PackageWorker(
        this.packageRoot,
        {},
        this.trustPolicy
      );

    try {
      await context.transaction
        .recordModifiedFile(
          context.resolveProjectPath(
            ".aurora/cache.json"
          )
        );

      await context.transaction
        .recordModifiedFile(
          context.resolveProjectPath(
            "aurora.lock"
          )
        );

      for (const batch of batches) {
        await Promise.all(
          batch.map(
            (packageName) =>
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

      await context.transaction
        .rollback();

      throw error;
    }
  }
}
