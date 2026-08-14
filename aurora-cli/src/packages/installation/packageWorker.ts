import path from "node:path";

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
  PackageCapabilityPolicy,
  type PackageExecutionPolicy,
} from "../execution/packageCapabilityPolicy.js";

import {
  PackageExecutionHost,
} from "../execution/packageExecutionHost.js";

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

export class PackageWorker {
  private readonly capabilityPolicy:
    PackageCapabilityPolicy;

  private readonly executionHost:
    PackageExecutionHost;

  constructor(
    private readonly packageRoot =
      getDefaultPackageRoot(),
    policy:
      PackageExecutionPolicy = {}
  ) {
    this.capabilityPolicy =
      new PackageCapabilityPolicy(
        policy
      );

    this.executionHost =
      new PackageExecutionHost(
        this.capabilityPolicy
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
     * code must pass artifact verification and
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
      await this.executionHost.run(
        manifest,
        this.packageRoot,
        hookDeclaration.path,
        "beforeInstall",
        context
      );
    }

    if (installerDeclaration) {
      const result =
        await this.executionHost.run(
          manifest,
          this.packageRoot,
          installerDeclaration.path,
          "install",
          context
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
        context,
        this.packageRoot
      );
    }

    if (hookDeclaration) {
      await this.executionHost.run(
        manifest,
        this.packageRoot,
        hookDeclaration.path,
        "afterInstall",
        context
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
