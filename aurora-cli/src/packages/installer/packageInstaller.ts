import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import type {
  PackageExecutionPolicy,
} from "../execution/packageCapabilityPolicy.js";

import type {
  PackageEnvironmentValueProvider,
} from "../execution/packageEnvironmentBroker.js";

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

import {
  DurableFileTransaction,
} from "../lifecycle/durableFileTransaction.js";

import {
  LockManager,
} from "../lock/lockManager.js";

import {
  calculateOfficialRegistryLockEntryDigest,
} from "../lock/lockSchema.js";

import {
  LifecycleRecoveryManager,
} from "../lifecycle/lifecycleRecoveryManager.js";

import {
  ProjectLifecycleLock,
} from "../lifecycle/projectLifecycleLock.js";

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
  loadVerifiedLockedOfficialRegistryManifest,
} from "../registry/officialRegistryInstallIdentity.js";

import {
  assertLockedOfficialRegistryPackage,
} from "../registry/officialRegistryPackageLocker.js";

import type {
  LockedOfficialRegistryPackage,
} from "../registry/officialRegistryPackageLocker.js";

import {
  PACKAGE_STATE_RELATIVE_PATH,
} from "../state/packageStateStore.js";

import {
  InstalledStateVerifier,
} from "../verify/installedStateVerifier.js";

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

  /**
   * Trusted host policy only.
   *
   * Package manifests may declare capabilities but
   * cannot populate this policy. Callers must opt in
   * explicitly when additional brokered authority is
   * intended.
   */
  executionPolicy?:
    PackageExecutionPolicy;

  /**
   * Trusted host data-plane only.
   *
   * No default provider exists. Package manifests,
   * project configuration, and normal CLI inputs
   * cannot populate this provider.
   */
  environmentProvider?:
    PackageEnvironmentValueProvider;

  /**
   * Authentic project-bound official registry lock receipts.
   *
   * When present, every package selected by dependency
   * resolution must have one of these receipts and the
   * installer preserves the full official lock identity.
   */
  lockedOfficialPackages?:
    readonly LockedOfficialRegistryPackage[];
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

  private readonly executionPolicy:
    PackageExecutionPolicy;

  private readonly environmentProvider:
    PackageEnvironmentValueProvider | undefined;

  private readonly lockedOfficialPackages:
    ReadonlyMap<
      string,
      LockedOfficialRegistryPackage
    >;

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

    this.executionPolicy =
      options.executionPolicy ??
      {};

    this.environmentProvider =
      options.environmentProvider;

    const lockedOfficialPackages =
      new Map<
        string,
        LockedOfficialRegistryPackage
      >();

    for (
      const locked
      of options.lockedOfficialPackages ??
        []
    ) {
      assertLockedOfficialRegistryPackage(
        locked
      );

      const packageId =
        locked.entry.packageId;

      if (
        lockedOfficialPackages.has(
          packageId
        )
      ) {
        throw new AuroraError(
          `Official package '${packageId}' has more than one verified lock receipt.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INTEGRITY_FAILED,
            suggestion:
              "Provide exactly one authentic project-bound lock receipt for each official package.",
          }
        );
      }

      lockedOfficialPackages.set(
        packageId,
        locked
      );
    }

    this.lockedOfficialPackages =
      lockedOfficialPackages;
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

    await this
      .assertOfficialInstallSet(
        packageId,
        packages
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
      const locked =
        this.lockedOfficialPackages
          .get(packageName);

      const manifest =
        locked === undefined
          ? await registry.getPackage(
              packageName
            )
          : await loadVerifiedLockedOfficialRegistryManifest(
              locked,
              this.packageRoot,
              this.projectRoot
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

    const lifecycleLock =
      await ProjectLifecycleLock
        .acquire(
          this.projectRoot
        );

    try {
      await new LifecycleRecoveryManager(
        this.projectRoot
      ).recoverIncomplete(
        lifecycleLock
      );

      const installed =
        await new CacheManager(
          this.projectRoot
        ).readExisting();

      checkConflicts(
        manifests,
        installed
      );

      const worker =
        new PackageWorker(
          this.packageRoot,
          this.executionPolicy,
          this.trustPolicy,
          undefined,
          this.environmentProvider,
          undefined,
          this.lockedOfficialPackages
        );

      const transaction =
        await DurableFileTransaction
          .begin({
            operationName:
              "package installation",

            operation:
              "install",

            packageIds:
              installationOrder,

            projectPath:
              this.projectRoot,
          });

      try {
        const context =
          new InstallerContext(
            this.projectRoot,
            transaction
          );

        await transaction
          .recordModifiedFile(
            context.resolveProjectPath(
              ".aurora/cache.json"
            )
          );

        await transaction
          .recordModifiedFile(
            context.resolveProjectPath(
              PACKAGE_STATE_RELATIVE_PATH
            )
          );

        await transaction
          .recordModifiedFile(
            context.resolveProjectPath(
              "aurora.lock"
            )
          );

        await transaction
          .beginMutation();

        for (const batch of batches) {
          for (
            const packageName
            of batch
          ) {
            await worker.install(
              packageName,
              context
            );
          }
        }

        await transaction
          .beginVerification();

        const installedStateVerifier =
          new InstalledStateVerifier();

        for (
          const packageName
          of installationOrder
        ) {
          if (
            installed[
              packageName
            ] !== undefined
          ) {
            continue;
          }

          await installedStateVerifier
            .verify(
              packageName,
              this.projectRoot
            );
        }

        await transaction
          .commitDurably();
      }
      catch (error) {
        console.log("");
        console.log(
          "Installation failed."
        );

        await transaction
          .rollback();

        throw error;
      }

      dependencyGraph.print();

      console.log(
        "Installation finished."
      );
    }
    finally {
      await lifecycleLock
        .release();
    }
  }

  private async assertOfficialInstallSet(
    requestedPackageId: string,
    resolvedPackageIds:
      readonly string[]
  ): Promise<void> {
    if (
      this.lockedOfficialPackages
        .size === 0
    ) {
      return;
    }

    if (
      !this.lockedOfficialPackages
        .has(requestedPackageId)
    ) {
      throw new AuroraError(
        `Official installation request '${requestedPackageId}' does not have an authentic verified lock receipt.`,
        {
          code:
            ErrorCodes
              .PACKAGE_INTEGRITY_FAILED,
          suggestion:
            "Resolve, acquire, extract, and lock every official package before installation.",
        }
      );
    }

    const resolved =
      new Set(
        resolvedPackageIds
      );

    for (
      const packageId
      of resolved
    ) {
      if (
        !this.lockedOfficialPackages
          .has(packageId)
      ) {
        throw new AuroraError(
          `Resolved dependency '${packageId}' does not have an authentic verified lock receipt.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INTEGRITY_FAILED,
            suggestion:
              "Materialize an authenticated lock receipt for every dependency before installation.",
          }
        );
      }
    }

    for (
      const packageId
      of this.lockedOfficialPackages
        .keys()
    ) {
      if (!resolved.has(packageId)) {
        throw new AuroraError(
          `Verified lock receipt '${packageId}' is not part of the requested dependency graph.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INTEGRITY_FAILED,
            suggestion:
              "Provide only the exact authenticated lock set selected for this installation.",
          }
        );
      }
    }

    const lockFile =
      await new LockManager(
        this.projectRoot
      ).read();

    for (
      const [
        packageId,
        locked,
      ]
      of this.lockedOfficialPackages
    ) {
      const persisted =
        lockFile.packages[packageId];

      if (
        typeof persisted ===
          "string" ||
        calculateOfficialRegistryLockEntryDigest(
          persisted
        ) !==
          calculateOfficialRegistryLockEntryDigest(
            locked.entry
          )
      ) {
        throw new AuroraError(
          `Official package '${packageId}' does not match its project aurora.lock entry.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INTEGRITY_FAILED,
            suggestion:
              "Restore the exact verified official lock entry before installation.",
          }
        );
      }
    }
  }
}
