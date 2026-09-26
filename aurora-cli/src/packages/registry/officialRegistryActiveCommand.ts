import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  OfficialRegistryActiveReader,
} from "./officialRegistryActiveReader.js";

import {
  OfficialRegistryResolver,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryVersionSelector,
  ResolvedOfficialRegistryPackage,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryVerifierOptions,
} from "./officialRegistryVerifier.js";

export interface ResolveActiveOfficialRegistryPackageOptions {
  readonly version?: string;
  readonly range?: string;
  readonly registryDigest?: string;
}

export interface OfficialRegistryActiveCommandDependencies {
  readonly workspaceRoot?: string;
  readonly registryDirectory?: string;
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
}

function selectorFailure(): AuroraError {
  return new AuroraError(
    "Official registry resolution accepts either --version or --range, not both.",
    {
      code:
        ErrorCodes
          .REGISTRY_ACTIVE_STATE_INVALID,
      suggestion:
        "Omit both options for latest, or provide one exact version or one semantic-version range.",
    }
  );
}

function createSelector(
  options:
    ResolveActiveOfficialRegistryPackageOptions
): OfficialRegistryVersionSelector {
  if (
    options.version !==
      undefined &&
    options.range !==
      undefined
  ) {
    throw selectorFailure();
  }

  if (
    options.version !==
      undefined
  ) {
    return {
      kind:
        "exact",
      version:
        options.version,
    };
  }

  if (
    options.range !==
      undefined
  ) {
    return {
      kind:
        "range",
      range:
        options.range,
    };
  }

  return {
    kind:
      "latest",
  };
}

export async function resolveActiveOfficialRegistryPackage(
  packageId: string,
  options:
    ResolveActiveOfficialRegistryPackageOptions = {},
  dependencies:
    OfficialRegistryActiveCommandDependencies = {}
): Promise<
  ResolvedOfficialRegistryPackage
> {
  const selector =
    createSelector(
      options
    );

  const active =
    await new OfficialRegistryActiveReader({
      workspaceRoot:
        dependencies
          .workspaceRoot ??
        process.cwd(),
      registryDirectory:
        dependencies
          .registryDirectory,
      expectedSnapshotDigest:
        options.registryDigest,
      registryVerifierOptions:
        dependencies
          .registryVerifierOptions,
    }).read();

  const resolved =
    new OfficialRegistryResolver(
      active.current.snapshot,
      {
        verifierOptions:
          dependencies
            .registryVerifierOptions,
        previous:
          active.previous,
      }
    ).resolve(
      packageId,
      selector
    );

  console.log();
  console.log(
    "Resolved package from the active official registry."
  );
  console.log(
    `Package: ${resolved.entry.packageId}@${resolved.entry.version}`
  );
  console.log(
    `Registry sequence: ${resolved.registrySequence}`
  );
  console.log(
    `Registry digest: ${resolved.registryDigest}`
  );
  console.log(
    `Archive digest: ${resolved.entry.archive.digest}`
  );
  console.log(
    `Archive size: ${resolved.entry.archive.size} bytes`
  );
  console.log(
    `Archive URL: ${resolved.entry.archive.url}`
  );

  return resolved;
}
