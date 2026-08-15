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

/*
 * BROKERED means that Aurora recognizes the capability as one
 * that may be implemented through a trusted host-side broker.
 *
 * It does NOT imply that the capability is enabled by default.
 */
export const BROKERED_PACKAGE_CAPABILITIES = [
  "host.secrets.read",
  "package.code.execute",
  "project.files.write",
  "project.dependencies.write",
  "project.environment.write",
] as const satisfies
  readonly PackageCapability[];

/*
 * Secret access is intentionally absent.
 *
 * host.secrets.read is never admitted by the generic capability
 * allow-list. It requires a matching packageSecretGrants entry
 * for the authenticated publisher, package, and requested secret.
 */
export const DEFAULT_PACKAGE_ALLOWED_CAPABILITIES = [
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

export interface PackageSecretGrant {
  readonly publisherId: string;
  readonly packageId: string;
  readonly secrets:
    readonly string[];
}

export interface PackageExecutionPolicy {
  readonly allowedCapabilities?:
    readonly PackageCapability[];

  /*
   * High-trust host admission for package secret reads.
   *
   * Matching is exact across publisher id, package id, and
   * secret name. Generic allowedCapabilities entries cannot
   * substitute for this scope.
   */
  readonly packageSecretGrants?:
    readonly PackageSecretGrant[];
}

type CapabilityManifest =
  Readonly<
    Pick<
      PackageManifest,
      | "id"
      | "publisher"
      | "capabilities"
      | "secrets"
    >
  >;

export class PackageCapabilityPolicy {
  private readonly allowedCapabilities:
    ReadonlySet<PackageCapability>;

  private readonly packageSecretGrants:
    readonly PackageSecretGrant[];

  constructor(
    policy:
      PackageExecutionPolicy = {}
  ) {
    /*
     * Defense in depth: even if a trusted caller mistakenly
     * places host.secrets.read in the broad allow-list, that
     * entry is ignored. Secret authority must be package-scoped.
     */
    this.allowedCapabilities =
      new Set<PackageCapability>(
        (
          policy.allowedCapabilities ??
          DEFAULT_PACKAGE_ALLOWED_CAPABILITIES
        ).filter(
          capability =>
            capability !==
            "host.secrets.read"
        )
      );

    this.packageSecretGrants =
      (policy.packageSecretGrants ?? [])
        .map(
          grant => ({
            publisherId:
              grant.publisherId,
            packageId:
              grant.packageId,
            secrets:
              [...grant.secrets],
          })
        );
  }

  assertManifest(
    manifest:
      CapabilityManifest
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
        capability ===
        "host.secrets.read"
      ) {
        if (
          !this.hasManifestSecretGrant(
            manifest
          )
        ) {
          this.deny(
            manifest.id,
            capability,
            "has no matching package-scoped secret grant in the active package execution policy"
          );
        }

        continue;
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
    manifest:
      CapabilityManifest,
    capability:
      PackageCapability
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
      capability ===
      "host.secrets.read"
    ) {
      if (
        !this.hasManifestSecretGrant(
          manifest
        )
      ) {
        this.deny(
          manifest.id,
          capability,
          "has no matching package-scoped secret grant in the active package execution policy"
        );
      }

      return;
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

  assertSecretAccess(
    manifest:
      CapabilityManifest,
    secretName: string
  ): void {
    this.assertCapability(
      manifest,
      "host.secrets.read"
    );

    const declared =
      (manifest.secrets ?? [])
        .some(
          secret =>
            secret.name ===
            secretName
        );

    if (!declared) {
      this.denySecret(
        manifest.id,
        secretName,
        "is not declared by the package manifest"
      );
    }

    if (
      !this.hasExactSecretGrant(
        manifest,
        secretName
      )
    ) {
      this.denySecret(
        manifest.id,
        secretName,
        "is denied by the active package-scoped secret policy"
      );
    }
  }

  private hasManifestSecretGrant(
    manifest:
      CapabilityManifest
  ): boolean {
    const declaredSecrets =
      new Set(
        (manifest.secrets ?? [])
          .map(
            secret =>
              secret.name
          )
      );

    return this.packageSecretGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.secrets.some(
            secretName =>
              declaredSecrets.has(
                secretName
              )
          )
      );
  }

  private hasExactSecretGrant(
    manifest:
      CapabilityManifest,
    secretName: string
  ): boolean {
    return this.packageSecretGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.secrets.includes(
            secretName
          )
      );
  }

  private deny(
    packageId: string,
    capability:
      PackageCapability,
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

  private denySecret(
    packageId: string,
    secretName: string,
    reason: string
  ): never {
    throw new AuroraError(
      `Package '${packageId}' secret '${secretName}' ${reason}.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Grant only the exact trusted publisher, package, and secret names required by the package.",
      }
    );
  }
}
