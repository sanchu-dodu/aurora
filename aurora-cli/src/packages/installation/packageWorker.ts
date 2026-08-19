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
  getDefaultPackageRoot,
} from "../packagePaths.js";

import {
  PackageRegistry,
} from "../registry/registry.js";

import {
  PackageOwnershipRecorder,
} from "../state/packageOwnershipRecorder.js";

import {
  PACKAGE_STATE_RELATIVE_PATH,
  PackageStateStore,
} from "../state/packageStateStore.js";

import {
  PackageTrustPolicy,
} from "../trust/packageTrustPolicy.js";

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
      PackageNetworkBroker
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
    context: InstallerContext
  ): Promise<void> {
    const registry =
      new PackageRegistry(
        this.packageRoot
      );

    const cache =
      new CacheManager(
        context.getProjectPath()
      );

    const manifest =
      await registry.getPackage(
        packageId
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
      this.packageRoot,
      manifest
    );

    this.capabilityPolicy
      .assertManifest(
        manifest
      );

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
        this.packageRoot,
        hookDeclaration.path,
        "beforeInstall",
        packageContext
      );
    }

    if (installerDeclaration) {
      const result =
        await executionHost.run(
          manifest,
          this.packageRoot,
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
        this.packageRoot
      );
    }

    if (hookDeclaration) {
      await executionHost.run(
        manifest,
        this.packageRoot,
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

    const ownershipReceipt =
      await ownershipRecorder
        .finalize();

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

    await lock.register(
      packageId,
      manifest.version
    );

    const end =
      performance.now();

    console.log(
      `✔ Complete (${(end - start).toFixed(0)} ms)`
    );

    console.log("");
  }
}
