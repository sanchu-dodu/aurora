import path from "node:path";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  OsCredentialStore,
} from "../../security/credentials/credentialStore.js";

import {
  CacheManager,
} from "../cache/cacheManager.js";

import {
  PackageCapabilityPolicy,
  type PackageExecutionPolicy,
} from "../execution/packageCapabilityPolicy.js";

import {
  PackageExecutionHost,
} from "../execution/packageExecutionHost.js";

import type {
  PackageNetworkBroker,
} from "../execution/packageNetworkBroker.js";

import {
  PackageEnvironmentBroker,
  type PackageEnvironmentValueProvider,
} from "../execution/packageEnvironmentBroker.js";

import {
  PackageProjectFileReadBroker,
} from "../execution/packageProjectFileReadBroker.js";

import {
  PackageSecretBroker,
  type PackageSecretReader,
} from "../execution/packageSecretBroker.js";

import {
  PackageArtifactVerifier,
} from "../integrity/packageArtifactVerifier.js";

import {
  installTemplates,
} from "../installer/templateInstaller.js";

import type {
  InstallerContext,
} from "../installer/installerContext.js";

import {
  IntegrityChecker,
} from "../integrity/integrityChecker.js";

import {
  LockManager,
} from "../lock/lockManager.js";

import {
  calculateOfficialRegistryLockEntryDigest,
} from "../lock/lockSchema.js";

import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  PackageRegistry,
} from "../registry/registry.js";

import {
  loadVerifiedLockedOfficialRegistryManifest,
} from "../registry/officialRegistryInstallIdentity.js";

import type {
  LockedOfficialRegistryPackage,
} from "../registry/officialRegistryPackageLocker.js";

import {
  PackageOwnershipRecorder,
} from "../state/packageOwnershipRecorder.js";

import {
  parsePackageStateReceipt,
} from "../state/packageStateSchema.js";

import type {
  PackageStateReceipt,
} from "../state/packageStateSchema.js";

import {
  PACKAGE_STATE_RELATIVE_PATH,
  PackageStateStore,
} from "../state/packageStateStore.js";

import {
  PackageTrustPolicy,
} from "../trust/packageTrustPolicy.js";

export interface PackageWorkerUpdateOptions {
  readonly mode:
    "update";

  readonly expectedVersion:
    string;
}

export interface PackageWorkerRepairOptions {
  readonly mode:
    "repair";

  readonly expectedVersion:
    string;

  readonly expectedPublisherId:
    string;

  readonly expectedArtifactSha256:
    string;
}

export interface PackageWorkerUpdateResult {
  readonly version:
    string;

  readonly checksum:
    string;

  readonly receipt:
    PackageStateReceipt;
}

export type PackageWorkerLifecycleResult =
  PackageWorkerUpdateResult;

export class PackageWorker {
  private readonly capabilityPolicy:
    PackageCapabilityPolicy;

  private readonly secretReader:
    PackageSecretReader;

  private readonly environmentReader:
    PackageEnvironmentBroker | undefined;

  constructor(
    private readonly packageRoot =
      getDefaultPackageRoot(),
    policy:
      PackageExecutionPolicy = {},
    private readonly trustPolicy =
      new PackageTrustPolicy(),
    secretReader:
      PackageSecretReader =
        new PackageSecretBroker(
          new OsCredentialStore()
        ),
    environmentProvider?:
      PackageEnvironmentValueProvider,
    private readonly networkBroker?:
      PackageNetworkBroker,
    private readonly lockedOfficialPackages:
      ReadonlyMap<
        string,
        LockedOfficialRegistryPackage
      > = new Map()
  ) {
    this.capabilityPolicy =
      new PackageCapabilityPolicy(
        policy
      );

    this.secretReader =
      secretReader;

    this.environmentReader =
      environmentProvider ===
        undefined
        ? undefined
        : new PackageEnvironmentBroker(
            environmentProvider
          );
  }

  async install(
    packageId: string,
    context: InstallerContext,
    options?:
      PackageWorkerUpdateOptions |
      PackageWorkerRepairOptions
  ): Promise<
    void |
    PackageWorkerLifecycleResult
  > {
    const registry =
      new PackageRegistry(
        this.packageRoot
      );

    const cache =
      new CacheManager(
        context.getProjectPath()
      );

    const locked =
      this.lockedOfficialPackages
        .get(packageId);

    const effectivePackageRoot =
      locked === undefined
        ? this.packageRoot
        : locked.extracted
            .stagingPath;

    if (
      this.lockedOfficialPackages
        .size > 0 &&
      locked === undefined
    ) {
      throw new AuroraError(
        `Package '${packageId}' reached official installation without an authentic verified lock receipt.`,
        {
          code:
            ErrorCodes
              .PACKAGE_INTEGRITY_FAILED,
          suggestion:
            "Reject the installation and materialize the complete authenticated lock set.",
        }
      );
    }

    const manifest =
      locked === undefined
        ? await registry.getPackage(
            packageId
          )
        : await loadVerifiedLockedOfficialRegistryManifest(
            locked,
            effectivePackageRoot,
            context.getProjectPath()
          );

    /*
     * Package trust is evaluated before the installed-cache
     * shortcut so publisher or signing-key revocation cannot
     * be bypassed by an existing cache entry.
     *
     * PackageInstaller also performs preflight verification,
     * but PackageWorker independently enforces trust for callers
     * that invoke this execution boundary directly.
     */
    this.trustPolicy.verify(
      manifest
    );

    if (
      options === undefined &&
      await cache.isInstalled(
        packageId
      )
    ) {
      console.log(
        `✓ ${packageId} is already installed`
      );

      console.log("");

      return;
    }

    /*
     * PackageWorker is the execution choke point.
     *
     * Every path that reaches executable package
     * code must already have passed publisher trust,
     * and must pass artifact verification plus
     * capability-policy evaluation here, including
     * callers outside PackageInstaller.
     */
    const verifier =
      new PackageArtifactVerifier();

    await verifier.verify(
      effectivePackageRoot,
      manifest
    );

    this.capabilityPolicy
      .assertManifest(
        manifest
      );

    /*
     * Explicit update and repair executions are
     * bound to the exact version selected by their
     * lifecycle coordinator.
     *
     * This check occurs after publisher trust,
     * artifact verification, and capability-policy
     * validation but before a mutation-capable
     * package InstallerContext is created.
     */
    if (
      options !== undefined &&
      manifest.version !==
        options.expectedVersion
    ) {
      throw new AuroraError(
        `Package '${packageId}' resolved version '${manifest.version}' while ${options.mode} execution requires '${options.expectedVersion}'.`,
        {
          code:
            ErrorCodes
              .PACKAGE_INTEGRITY_FAILED,

          suggestion:
            "Re-run the update check and execute only the exact version that was planned.",
        }
      );
    }

    /*
     * Repair must never execute a same-version artifact
     * that differs from the exact publisher and artifact
     * identity recorded at installation time. These gates
     * run before any package-controlled code receives a
     * mutation-capable context.
     */
    if (
      options?.mode ===
        "repair" &&
      manifest.publisher.id !==
        options.expectedPublisherId
    ) {
      throw new AuroraError(
        `Package '${packageId}' resolved publisher '${manifest.publisher.id}' while repair requires '${options.expectedPublisherId}'.`,
        {
          code:
            ErrorCodes
              .PACKAGE_INTEGRITY_FAILED,

          suggestion:
            "Restore the exact trusted package artifact recorded by the installed ownership receipt before retrying repair.",
        }
      );
    }

    if (
      options?.mode ===
        "repair" &&
      manifest.artifact.digest !==
        options.expectedArtifactSha256
    ) {
      throw new AuroraError(
        `Package '${packageId}' resolved artifact '${manifest.artifact.digest}' while repair requires '${options.expectedArtifactSha256}'.`,
        {
          code:
            ErrorCodes
              .PACKAGE_INTEGRITY_FAILED,

          suggestion:
            "Restore the exact trusted package artifact recorded by the installed ownership receipt before retrying repair.",
        }
      );
    }

    const ownershipRecorder =
      new PackageOwnershipRecorder(
        context.getProjectPath(),
        manifest
      );

    const packageContext =
      context.createPackageScope(
        ownershipRecorder
      );

    const projectFileReader =
      new PackageProjectFileReadBroker({
        projectRoot:
          packageContext.getProjectPath(),
        accessPolicy:
          this.capabilityPolicy,
      });

    const executionHost =
      new PackageExecutionHost(
        this.capabilityPolicy,
        this.secretReader,
        this.environmentReader,
        projectFileReader,
        this.networkBroker
      );

    console.log(
      `Installing ${packageId}...`
    );

    const start =
      performance.now();

    const hookDeclaration =
      manifest.files.find(
        file =>
          file.role === "hook"
      );

    const installerDeclaration =
      manifest.files.find(
        file =>
          file.role === "installer"
      );

    const hasTemplates =
      manifest.files.some(
        file =>
          file.role === "template"
      );

    if (hookDeclaration) {
      await executionHost.run(
        manifest,
        effectivePackageRoot,
        hookDeclaration.path,
        "beforeInstall",
        packageContext
      );
    }

    if (installerDeclaration) {
      const result =
        await executionHost.run(
          manifest,
          effectivePackageRoot,
          installerDeclaration.path,
          "install",
          packageContext
        );

      /*
       * Preserve the old installer contract:
       * a declared installer must export install().
       */
      if (!result.executed) {
        throw new AuroraError(
          `Declared installer '${installerDeclaration.path}' for package '${manifest.id}' does not export an install function.`,
          {
            code:
              ErrorCodes
                .INVALID_PACKAGE_MANIFEST,
            suggestion:
              "Export an async install(context) function from the declared installer.",
          }
        );
      }
    }
    else {
      console.log(
        "No installer found."
      );
    }

    /*
     * Templates execute in trusted host code rather
     * than package JavaScript, but they are still a
     * project mutation and therefore require the
     * active files.write capability.
     */
    if (hasTemplates) {
      this.capabilityPolicy
        .assertCapability(
          manifest,
          "project.files.write"
        );

      await installTemplates(
        manifest,
        packageContext,
        effectivePackageRoot
      );
    }

    if (hookDeclaration) {
      await executionHost.run(
        manifest,
        effectivePackageRoot,
        hookDeclaration.path,
        "afterInstall",
        packageContext
      );
    }

    const integrity =
      new IntegrityChecker();

    const checksum =
      await integrity.checksum(
        path.join(
          context.getProjectPath(),
          "package.json"
        )
      );

    const capturedOwnershipReceipt =
      await ownershipRecorder
        .finalize();

    const ownershipReceipt =
      locked === undefined
        ? capturedOwnershipReceipt
        : parsePackageStateReceipt({
            ...capturedOwnershipReceipt,
            officialLockSha256:
              calculateOfficialRegistryLockEntryDigest(
                locked.entry
              ),
          });

    /*
     * Explicit update and repair modes deliberately
     * stop here.
     *
     * The caller receives the fresh ownership
     * capture while package-state, cache, and lock
     * persistence remain deferred to the
     * ownership-aware lifecycle coordinator.
     *
     * Normal installation continues through the
     * original metadata block below unchanged.
     */
    if (
      options !== undefined
    ) {
      return {
        version:
          manifest.version,

        checksum,

        receipt:
          ownershipReceipt,
      };
    }

    await context.transaction
      .recordModifiedFile(
        context.resolveProjectPath(
          PACKAGE_STATE_RELATIVE_PATH
        )
      );

    await new PackageStateStore(
      context.getProjectPath()
    ).upsertReceipt(
      ownershipReceipt
    );

    await cache.install(
      packageId,
      manifest.version,
      checksum
    );

    const lock =
      new LockManager(
        context.getProjectPath()
      );

    if (locked === undefined) {
      await lock.register(
        packageId,
        manifest.version
      );
    }
    else {
      await lock.registerOfficial(
        packageId,
        locked.entry
      );
    }

    const end =
      performance.now();

    console.log(
      `✔ Complete (${(end - start).toFixed(0)} ms)`
    );

    console.log("");
  }
}
