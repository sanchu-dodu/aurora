import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

export type PackageCapability =
  PackageManifest["capabilities"][number];

export const BROKERED_PACKAGE_CAPABILITIES = [
  "package.code.execute",
  "project.files.write",
  "project.dependencies.write",
  "project.environment.write",
] as const satisfies
  readonly PackageCapability[];

const brokeredCapabilities =
  new Set<PackageCapability>(
    BROKERED_PACKAGE_CAPABILITIES
  );

export interface PackageExecutionPolicy {
  readonly allowedCapabilities?:
    readonly PackageCapability[];
}

export class PackageCapabilityPolicy {
  private readonly allowedCapabilities:
    ReadonlySet<PackageCapability>;

  constructor(
    policy: PackageExecutionPolicy = {}
  ) {
    this.allowedCapabilities =
      new Set<PackageCapability>(
        policy.allowedCapabilities ??
        BROKERED_PACKAGE_CAPABILITIES
      );
  }

  assertManifest(
    manifest: Pick<
      PackageManifest,
      "id" | "capabilities"
    >
  ): void {
    for (
      const capability
      of manifest.capabilities
    ) {
      if (
        !brokeredCapabilities.has(
          capability
        )
      ) {
        this.deny(
          manifest.id,
          capability,
          "is not supported by the package capability broker"
        );
      }

      if (
        !this.allowedCapabilities.has(
          capability
        )
      ) {
        this.deny(
          manifest.id,
          capability,
          "is denied by the active package execution policy"
        );
      }
    }
  }

  assertCapability(
    manifest: Pick<
      PackageManifest,
      "id" | "capabilities"
    >,
    capability: PackageCapability
  ): void {
    if (
      !manifest.capabilities.includes(
        capability
      )
    ) {
      this.deny(
        manifest.id,
        capability,
        "is not declared by the package manifest"
      );
    }

    if (
      !brokeredCapabilities.has(
        capability
      )
    ) {
      this.deny(
        manifest.id,
        capability,
        "is not supported by the package capability broker"
      );
    }

    if (
      !this.allowedCapabilities.has(
        capability
      )
    ) {
      this.deny(
        manifest.id,
        capability,
        "is denied by the active package execution policy"
      );
    }
  }

  private deny(
    packageId: string,
    capability: PackageCapability,
    reason: string
  ): never {
    throw new AuroraError(
      `Package '${packageId}' capability '${capability}' ${reason}.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Use a trusted package whose declared capabilities are supported and permitted by Aurora.",
      }
    );
  }
}
