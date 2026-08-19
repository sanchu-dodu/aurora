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

export type PackageNetworkMethod =
  NonNullable<
    PackageManifest["networkAccess"]
  >[number]["methods"][number];

/*
 * BROKERED means that Aurora recognizes the capability as one
 * that may be implemented through a trusted host-side broker.
 *
 * It does NOT imply that the capability is enabled by default.
 */
export const BROKERED_PACKAGE_CAPABILITIES = [
  "host.environment.read",
  "host.secrets.read",
  "network.access",
  "package.code.execute",
  "project.files.read",
  "project.files.write",
  "project.dependencies.write",
  "project.environment.write",
] as const satisfies
  readonly PackageCapability[];

/*
 * Scoped host read capabilities are intentionally absent.
 *
 * host.environment.read and host.secrets.read are never admitted
 * by the generic capability allow-list. Each requires a matching
 * package-scoped grant for the authenticated publisher, package,
 * and requested resource.
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

export interface PackageProjectFileGrant {
  readonly publisherId: string;
  readonly packageId: string;
  readonly paths:
    readonly string[];
}

export interface PackageEnvironmentGrant {
  readonly publisherId: string;
  readonly packageId: string;
  readonly variables:
    readonly string[];
}

export interface PackageSecretGrant {
  readonly publisherId: string;
  readonly packageId: string;
  readonly secrets:
    readonly string[];
}

export interface PackageNetworkGrant {
  readonly publisherId: string;
  readonly packageId: string;
  readonly origin: string;
  readonly methods:
    readonly PackageNetworkMethod[];
}

export interface PackageExecutionPolicy {
  readonly allowedCapabilities?:
    readonly PackageCapability[];

  /*
   * High-trust host admission for project file reads.
   * Matching is exact across publisher id, package id,
   * and canonical manifest-declared relative path.
   */
  readonly packageProjectFileGrants?:
    readonly PackageProjectFileGrant[];

  /*
   * High-trust host admission for non-secret host
   * environment reads. Matching is exact across
   * publisher id, package id, and variable name.
   */
  readonly packageEnvironmentGrants?:
    readonly PackageEnvironmentGrant[];

  /*
   * High-trust host admission for package secret reads.
   *
   * Matching is exact across publisher id, package id, and
   * secret name. Generic allowedCapabilities entries cannot
   * substitute for this scope.
   */
  readonly packageSecretGrants?:
    readonly PackageSecretGrant[];

  /*
   * High-trust host admission for package network egress.
   * Matching is exact across authenticated publisher id,
   * package id, canonical manifest origin, and HTTP method.
   * Generic allowedCapabilities entries cannot grant it.
   */
  readonly packageNetworkGrants?:
    readonly PackageNetworkGrant[];
}

type CapabilityManifest =
  Readonly<
    Pick<
      PackageManifest,
      | "id"
      | "publisher"
      | "capabilities"
      | "projectFileReads"
      | "hostEnvironment"
      | "secrets"
      | "networkAccess"
    >
  >;

export class PackageCapabilityPolicy {
  private readonly allowedCapabilities:
    ReadonlySet<PackageCapability>;

  private readonly packageProjectFileGrants:
    readonly PackageProjectFileGrant[];

  private readonly packageEnvironmentGrants:
    readonly PackageEnvironmentGrant[];

  private readonly packageSecretGrants:
    readonly PackageSecretGrant[];

  private readonly packageNetworkGrants:
    readonly PackageNetworkGrant[];

  constructor(
    policy:
      PackageExecutionPolicy = {}
  ) {
    /*
     * Defense in depth: scoped host-read capabilities are
     * ignored if a trusted caller mistakenly places them in
     * the broad allow-list. Their authority must be package-scoped.
     */
    this.allowedCapabilities =
      new Set<PackageCapability>(
        (
          policy.allowedCapabilities ??
          DEFAULT_PACKAGE_ALLOWED_CAPABILITIES
        ).filter(
          capability =>
            capability !==
              "project.files.read" &&
            capability !==
              "host.environment.read" &&
            capability !==
              "host.secrets.read" &&
            capability !==
              "network.access"
        )
      );

    this.packageProjectFileGrants =
      (policy.packageProjectFileGrants ?? [])
        .map(
          grant => ({
            publisherId:
              grant.publisherId,
            packageId:
              grant.packageId,
            paths:
              [...grant.paths],
          })
        );

    this.packageEnvironmentGrants =
      (policy.packageEnvironmentGrants ?? [])
        .map(
          grant => ({
            publisherId:
              grant.publisherId,
            packageId:
              grant.packageId,
            variables:
              [...grant.variables],
          })
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

    this.packageNetworkGrants =
      (policy.packageNetworkGrants ?? [])
        .map(
          grant => ({
            publisherId:
              grant.publisherId,
            packageId:
              grant.packageId,
            origin:
              grant.origin,
            methods:
              [...grant.methods],
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
        "project.files.read"
      ) {
        if (
          !this.hasManifestProjectFileGrant(
            manifest
          )
        ) {
          this.deny(
            manifest.id,
            capability,
            "has no matching package-scoped project-file grant in the active package execution policy"
          );
        }

        continue;
      }

      if (
        capability ===
        "host.environment.read"
      ) {
        if (
          !this.hasManifestEnvironmentGrant(
            manifest
          )
        ) {
          this.deny(
            manifest.id,
            capability,
            "has no matching package-scoped environment grant in the active package execution policy"
          );
        }

        continue;
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
        capability ===
        "network.access"
      ) {
        if (
          !this.hasManifestNetworkGrant(
            manifest
          )
        ) {
          this.deny(
            manifest.id,
            capability,
            "has no matching package-scoped network grant in the active package execution policy"
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
      "project.files.read"
    ) {
      if (
        !this.hasManifestProjectFileGrant(
          manifest
        )
      ) {
        this.deny(
          manifest.id,
          capability,
          "has no matching package-scoped project-file grant in the active package execution policy"
        );
      }

      return;
    }

    if (
      capability ===
      "host.environment.read"
    ) {
      if (
        !this.hasManifestEnvironmentGrant(
          manifest
        )
      ) {
        this.deny(
          manifest.id,
          capability,
          "has no matching package-scoped environment grant in the active package execution policy"
        );
      }

      return;
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
      capability ===
      "network.access"
    ) {
      if (
        !this.hasManifestNetworkGrant(
          manifest
        )
      ) {
        this.deny(
          manifest.id,
          capability,
          "has no matching package-scoped network grant in the active package execution policy"
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

  assertProjectFileReadAccess(
    manifest:
      CapabilityManifest,
    relativePath: string
  ): void {
    this.assertCapability(
      manifest,
      "project.files.read"
    );

    const declared =
      (manifest.projectFileReads ?? [])
        .some(
          file =>
            file.path ===
            relativePath
        );

    if (!declared) {
      this.denyProjectFileRead(
        manifest.id,
        relativePath,
        "is not declared by the package manifest"
      );
    }

    if (
      !this.hasExactProjectFileGrant(
        manifest,
        relativePath
      )
    ) {
      this.denyProjectFileRead(
        manifest.id,
        relativePath,
        "is denied by the active package-scoped project-file policy"
      );
    }
  }

  assertEnvironmentAccess(
    manifest:
      CapabilityManifest,
    variableName: string
  ): void {
    this.assertCapability(
      manifest,
      "host.environment.read"
    );

    const declared =
      (manifest.hostEnvironment ?? [])
        .some(
          variable =>
            variable.name ===
            variableName
        );

    if (!declared) {
      this.denyEnvironment(
        manifest.id,
        variableName,
        "is not declared by the package manifest"
      );
    }

    if (
      !this.hasExactEnvironmentGrant(
        manifest,
        variableName
      )
    ) {
      this.denyEnvironment(
        manifest.id,
        variableName,
        "is denied by the active package-scoped environment policy"
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

  assertNetworkAccess(
    manifest:
      CapabilityManifest,
    origin: string,
    method:
      PackageNetworkMethod
  ): void {
    this.assertCapability(
      manifest,
      "network.access"
    );

    const declaration =
      (manifest.networkAccess ?? [])
        .find(
          candidate =>
            candidate.origin ===
            origin
        );

    if (!declaration) {
      this.denyNetwork(
        manifest.id,
        origin,
        method,
        "origin is not declared by the package manifest"
      );
    }

    if (
      !declaration.methods.includes(
        method
      )
    ) {
      this.denyNetwork(
        manifest.id,
        origin,
        method,
        "method is not declared for that origin by the package manifest"
      );
    }

    if (
      !this.hasExactNetworkGrant(
        manifest,
        origin,
        method
      )
    ) {
      this.denyNetwork(
        manifest.id,
        origin,
        method,
        "is denied by the active package-scoped network policy"
      );
    }
  }
  private hasManifestProjectFileGrant(
    manifest:
      CapabilityManifest
  ): boolean {
    const declaredPaths =
      new Set(
        (manifest.projectFileReads ?? [])
          .map(
            file =>
              file.path
          )
      );

    return this.packageProjectFileGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.paths.some(
            relativePath =>
              declaredPaths.has(
                relativePath
              )
          )
      );
  }

  private hasExactProjectFileGrant(
    manifest:
      CapabilityManifest,
    relativePath: string
  ): boolean {
    return this.packageProjectFileGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.paths.includes(
            relativePath
          )
      );
  }

  private hasManifestEnvironmentGrant(
    manifest:
      CapabilityManifest
  ): boolean {
    const declaredVariables =
      new Set(
        (manifest.hostEnvironment ?? [])
          .map(
            variable =>
              variable.name
          )
      );

    return this.packageEnvironmentGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.variables.some(
            variableName =>
              declaredVariables.has(
                variableName
              )
          )
      );
  }

  private hasExactEnvironmentGrant(
    manifest:
      CapabilityManifest,
    variableName: string
  ): boolean {
    return this.packageEnvironmentGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.variables.includes(
            variableName
          )
      );
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

  private hasManifestNetworkGrant(
    manifest:
      CapabilityManifest
  ): boolean {
    return (
      manifest.networkAccess ?? []
    ).some(
      declaration =>
        this.packageNetworkGrants
          .some(
            grant =>
              grant.publisherId ===
                manifest.publisher.id &&
              grant.packageId ===
                manifest.id &&
              grant.origin ===
                declaration.origin &&
              grant.methods.some(
                method =>
                  declaration.methods.includes(
                    method
                  )
              )
          )
    );
  }

  private hasExactNetworkGrant(
    manifest:
      CapabilityManifest,
    origin: string,
    method:
      PackageNetworkMethod
  ): boolean {
    return this.packageNetworkGrants
      .some(
        grant =>
          grant.publisherId ===
            manifest.publisher.id &&
          grant.packageId ===
            manifest.id &&
          grant.origin ===
            origin &&
          grant.methods.includes(
            method
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

  private denyNetwork(
    packageId: string,
    origin: string,
    method:
      PackageNetworkMethod,
    reason: string
  ): never {
    throw new AuroraError(
      `Package '${packageId}' network request '${method} ${origin}' ${reason}.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Grant only the exact trusted publisher, package, manifest-declared canonical origin, and HTTP methods required by the package.",
      }
    );
  }
  private denyProjectFileRead(
    packageId: string,
    relativePath: string,
    reason: string
  ): never {
    throw new AuroraError(
      `Package '${packageId}' project file '${relativePath}' ${reason}.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Grant only the exact trusted publisher, package, and manifest-declared project file paths required by the package.",
      }
    );
  }

  private denyEnvironment(
    packageId: string,
    variableName: string,
    reason: string
  ): never {
    throw new AuroraError(
      `Package '${packageId}' host environment variable '${variableName}' ${reason}.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Grant only the exact trusted publisher, package, and non-secret host environment variables required by the package.",
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
