import {
  AURORA_CLI_VERSION,
} from "../../core/packageMetadata.js";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  satisfiesManifestVersionRange,
} from "../version/manifestVersion.js";

export interface CompatibilityEnvironment {
  readonly auroraVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
}

function incompatible(
  manifest: PackageManifest,
  message: string
): AuroraError {
  return new AuroraError(
    `Package '${manifest.id}' is incompatible: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INCOMPATIBLE,
      suggestion:
        "Use a compatible package release or update the Aurora runtime environment.",
    }
  );
}

export class CompatibilityChecker {
  constructor(
    private readonly environment:
      CompatibilityEnvironment = {
        auroraVersion:
          AURORA_CLI_VERSION,
        nodeVersion:
          process.versions.node,
        platform:
          process.platform,
        architecture:
          process.arch,
      }
  ) {}

  check(
    manifest: PackageManifest
  ): void {
    console.log(
      `Checking compatibility for ${manifest.id}...`
    );

    if (manifest.lifecycle.revoked) {
      throw new AuroraError(
        `Package '${manifest.id}' is revoked: ${manifest.lifecycle.reason ?? "No reason supplied."}`,
        {
          code:
            ErrorCodes
              .PACKAGE_REVOKED,
          suggestion:
            "Do not install revoked packages. Select a trusted replacement.",
        }
      );
    }

    if (
      !satisfiesManifestVersionRange(
        this.environment.auroraVersion,
        manifest.compatibility.aurora
      )
    ) {
      throw incompatible(
        manifest,
        `Aurora ${this.environment.auroraVersion} does not satisfy ${manifest.compatibility.aurora}.`
      );
    }

    if (
      !satisfiesManifestVersionRange(
        this.environment.nodeVersion,
        manifest.compatibility.node
      )
    ) {
      throw incompatible(
        manifest,
        `Node.js ${this.environment.nodeVersion} does not satisfy ${manifest.compatibility.node}.`
      );
    }

    if (
      !manifest.platforms.os.includes(
        "any"
      ) &&
      !manifest.platforms.os.includes(
        this.environment.platform as
          PackageManifest["platforms"]["os"][number]
      )
    ) {
      throw incompatible(
        manifest,
        `Operating system '${this.environment.platform}' is not supported.`
      );
    }

    if (
      !manifest.platforms.architecture
        .includes("any") &&
      !manifest.platforms.architecture
        .includes(
          this.environment.architecture as
            PackageManifest["platforms"]["architecture"][number]
        )
    ) {
      throw incompatible(
        manifest,
        `Architecture '${this.environment.architecture}' is not supported.`
      );
    }

    if (manifest.lifecycle.deprecated) {
      console.warn(
        `Package '${manifest.id}' is deprecated: ${manifest.lifecycle.reason ?? "No reason supplied."}`
      );
    }

    console.log(
      `Compatibility OK (${manifest.version})`
    );
  }
}
