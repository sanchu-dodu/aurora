import {
  assertCanonicalPackageIdentifier,
} from "../packageValidator.js";

import {
  isManifestSemVer,
  isManifestVersionRange,
  satisfiesManifestVersionRange,
} from "../version/manifestVersion.js";

import {
  OfficialRegistryCatalog,
  type OfficialRegistryCatalogOptions,
} from "./officialRegistryCatalog.js";

import {
  compareOfficialRegistryPackageEntries,
  type OfficialRegistryPackageEntry,
} from "./officialRegistrySchema.js";

import type {
  VerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

export type OfficialRegistryVersionSelector =
  | {
      readonly kind:
        "latest";
    }
  | {
      readonly kind:
        "exact";

      readonly version:
        string;
    }
  | {
      readonly kind:
        "range";

      readonly range:
        string;
    };

export interface ResolvedOfficialRegistryPackage {
  readonly registryDigest:
    string;

  readonly registrySequence:
    number;

  readonly entry:
    OfficialRegistryPackageEntry;
}

const LATEST_SELECTOR =
  Object.freeze({
    kind:
      "latest",
  } as const);

function resolutionFailure(
  message: string
): Error {
  return new Error(
    `Official package registry resolution failed: ${message}`
  );
}

function assertActiveEntry(
  entry:
    OfficialRegistryPackageEntry
): void {
  if (
    entry.lifecycle.status ===
      "revoked"
  ) {
    throw resolutionFailure(
      `package '${entry.packageId}@${entry.version}' is revoked: ${entry.lifecycle.reason}.`
    );
  }
}

function createResolution(
  catalog:
    OfficialRegistryCatalog,
  entry:
    OfficialRegistryPackageEntry
): ResolvedOfficialRegistryPackage {
  assertActiveEntry(
    entry
  );

  return Object.freeze({
    registryDigest:
      catalog.digest,

    registrySequence:
      catalog.sequence,

    entry,
  });
}

function assertExactVersion(
  version: string
): void {
  if (
    !isManifestSemVer(
      version
    )
  ) {
    throw resolutionFailure(
      `invalid exact semantic version '${version}'.`
    );
  }
}

function assertVersionRange(
  range: string
): void {
  if (
    !isManifestVersionRange(
      range
    )
  ) {
    throw resolutionFailure(
      `invalid semantic-version range '${range}'.`
    );
  }
}

export class OfficialRegistryResolver {
  private readonly catalog:
    OfficialRegistryCatalog;

  constructor(
    value: unknown,
    options:
      OfficialRegistryCatalogOptions = {}
  ) {
    /*
     * Construct the catalog internally so every resolution
     * begins with the official registry verifier's complete
     * authenticity, continuity, and immutability checks.
     */
    this.catalog =
      new OfficialRegistryCatalog(
        value,
        options
      );

    Object.freeze(
      this
    );
  }

  get verifiedSnapshot():
    VerifiedOfficialRegistrySnapshot {
    return this.catalog
      .verifiedSnapshot;
  }

  get digest():
    string {
    return this.catalog.digest;
  }

  get sequence():
    number {
    return this.catalog.sequence;
  }

  resolve(
    packageId: string,
    selector:
      OfficialRegistryVersionSelector =
        LATEST_SELECTOR
  ):
    ResolvedOfficialRegistryPackage {
    assertCanonicalPackageIdentifier(
      packageId
    );

    if (
      typeof selector !==
        "object" ||
      selector === null ||
      Array.isArray(
        selector
      )
    ) {
      throw resolutionFailure(
        "unsupported version selector."
      );
    }

    switch (
      selector.kind
    ) {
      case "latest":
        return this.resolveLatest(
          packageId
        );

      case "exact":
        return this.resolveExact(
          packageId,
          selector.version
        );

      case "range":
        return this.resolveRange(
          packageId,
          selector.range
        );

      default:
        throw resolutionFailure(
          "unsupported version selector."
        );
    }
  }

  private resolveLatest(
    packageId: string
  ):
    ResolvedOfficialRegistryPackage {
    const entry =
      this.catalog
        .getLatestPackageVersion(
          packageId
        );

    if (
      entry !== undefined
    ) {
      return createResolution(
        this.catalog,
        entry
      );
    }

    const publishedVersions =
      this.catalog
        .listPackageVersions(
          packageId,
          {
            includeRevoked:
              true,
          }
        );

    if (
      publishedVersions.length > 0
    ) {
      throw resolutionFailure(
        `package '${packageId}' has no active versions.`
      );
    }

    throw resolutionFailure(
      `package '${packageId}' is not present in the verified registry.`
    );
  }

  private resolveExact(
    packageId: string,
    version: string
  ):
    ResolvedOfficialRegistryPackage {
    assertExactVersion(
      version
    );

    const entry =
      this.catalog
        .getPackageVersion(
          packageId,
          version,
          {
            includeRevoked:
              true,
          }
        );

    if (
      entry === undefined
    ) {
      throw resolutionFailure(
        `package '${packageId}@${version}' is not present in the verified registry.`
      );
    }

    return createResolution(
      this.catalog,
      entry
    );
  }

  private resolveRange(
    packageId: string,
    range: string
  ):
    ResolvedOfficialRegistryPackage {
    assertVersionRange(
      range
    );

    const matching =
      this.catalog
        .listPackageVersions(
          packageId,
          {
            includeRevoked:
              true,
          }
        )
        .filter(
          (entry) =>
            satisfiesManifestVersionRange(
              entry.version,
              range
            )
        );

    let selected:
      OfficialRegistryPackageEntry |
      undefined;

    for (
      const entry
      of matching
    ) {
      if (
        entry.lifecycle.status !==
          "active"
      ) {
        continue;
      }

      if (
        selected === undefined ||
        compareOfficialRegistryPackageEntries(
          selected,
          entry
        ) < 0
      ) {
        selected = entry;
      }
    }

    if (
      selected !== undefined
    ) {
      return createResolution(
        this.catalog,
        selected
      );
    }

    if (
      matching.length > 0
    ) {
      throw resolutionFailure(
        `all versions of '${packageId}' satisfying '${range}' are revoked.`
      );
    }

    if (
      !this.catalog.hasPackage(
        packageId,
        {
          includeRevoked:
            true,
        }
      )
    ) {
      throw resolutionFailure(
        `package '${packageId}' is not present in the verified registry.`
      );
    }

    throw resolutionFailure(
      `no version of '${packageId}' satisfies '${range}'.`
    );
  }
}
