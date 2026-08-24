import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageExecutionPolicy,
} from "../execution/packageCapabilityPolicy.js";

import type {
  PackageEnvironmentValueProvider,
} from "../execution/packageEnvironmentBroker.js";

import {
  PackageInstaller,
} from "../installer/packageInstaller.js";

import type {
  PackageTrustPolicyOptions,
} from "../trust/packageTrustPolicy.js";

import {
  assertLockedOfficialRegistryPackage,
} from "./officialRegistryPackageLocker.js";

import type {
  LockedOfficialRegistryPackage,
} from "./officialRegistryPackageLocker.js";

export interface OfficialRegistryPackageInstallerOptions {
  readonly projectRoot: string;
  readonly trust?:
    PackageTrustPolicyOptions;
  readonly executionPolicy?:
    PackageExecutionPolicy;
  readonly environmentProvider?:
    PackageEnvironmentValueProvider;
}

export class OfficialRegistryPackageInstaller {
  private readonly projectRoot:
    string;

  constructor(
    private readonly options:
      OfficialRegistryPackageInstallerOptions
  ) {
    this.projectRoot =
      new ProjectPathBoundary(
        options.projectRoot
      ).projectRoot;

    Object.freeze(this);
  }

  async install(
    locked:
      LockedOfficialRegistryPackage
  ): Promise<void> {
    await this.installSet(
      locked,
      []
    );
  }

  async installSet(
    requested:
      LockedOfficialRegistryPackage,
    dependencies:
      readonly LockedOfficialRegistryPackage[]
  ): Promise<void> {
    assertLockedOfficialRegistryPackage(
      requested
    );

    const lockedOfficialPackages = [
      requested,
      ...dependencies,
    ];

    const packageIds =
      new Set<string>();

    for (
      const locked
      of lockedOfficialPackages
    ) {
      assertLockedOfficialRegistryPackage(
        locked
      );

      if (
        locked.projectRoot !==
          this.projectRoot
      ) {
        throw new AuroraError(
          `Official package '${locked.entry.packageId}' lock receipt belongs to a different project.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INTEGRITY_FAILED,
            suggestion:
              "Lock every verified package for this exact project before installation.",
          }
        );
      }

      if (
        packageIds.has(
          locked.entry.packageId
        )
      ) {
        throw new AuroraError(
          `Official package '${locked.entry.packageId}' appears more than once in the requested install set.`,
          {
            code:
              ErrorCodes
                .PACKAGE_INTEGRITY_FAILED,
            suggestion:
              "Provide exactly one authentic lock receipt for every selected package.",
          }
        );
      }

      packageIds.add(
        locked.entry.packageId
      );
    }

    await new PackageInstaller({
      packageRoot:
        requested.extracted
          .stagingPath,
      projectRoot:
        this.projectRoot,
      trust:
        this.options.trust,
      executionPolicy:
        this.options
          .executionPolicy,
      environmentProvider:
        this.options
          .environmentProvider,
      lockedOfficialPackages: [
        ...lockedOfficialPackages,
      ],
    }).install(
      requested.entry.packageId
    );
  }
}
