import {
  assertCanonicalPackageIdentifier,
} from "../packageValidator.js";

import {
  isManifestSemVer,
} from "../version/manifestVersion.js";

import {
  compareOfficialRegistryPackageEntries,
  type OfficialRegistryPackageEntry,
} from "./officialRegistrySchema.js";

import {
  OfficialRegistryVerifier,
  type OfficialRegistryVerifierOptions,
  type VerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

export interface OfficialRegistryCatalogQueryOptions {
  readonly includeRevoked?:
    boolean;
}

export interface OfficialRegistryCatalogOptions {
  readonly verifierOptions?:
    OfficialRegistryVerifierOptions;

  readonly previous?:
    VerifiedOfficialRegistrySnapshot;
}

function catalogFailure(
  message: string
): Error {
  return new Error(
    `Official package registry catalog query failed: ${message}`
  );
}

function assertCanonicalRegistryVersion(
  version: string
): void {
  if (
    !isManifestSemVer(
      version
    )
  ) {
    throw catalogFailure(
      `invalid semantic version '${version}'.`
    );
  }
}

function entryIsVisible(
  entry:
    OfficialRegistryPackageEntry,
  options:
    OfficialRegistryCatalogQueryOptions
): boolean {
  return (
    options.includeRevoked === true ||
    entry.lifecycle.status ===
      "active"
  );
}

export class OfficialRegistryCatalog {
  private readonly verified:
    VerifiedOfficialRegistrySnapshot;

  constructor(
    value: unknown,
    options:
      OfficialRegistryCatalogOptions = {}
  ) {
    /*
     * Construct the verifier internally so callers may
     * configure trust policy but cannot replace the
     * cryptographic verification implementation.
     */
    const verifier =
      new OfficialRegistryVerifier(
        options.verifierOptions
      );

    /*
     * The catalog never treats a structurally typed
     * VerifiedOfficialRegistrySnapshot as sufficient proof
     * that current registry metadata is authentic.
     *
     * Raw current snapshot input always crosses the
     * OfficialRegistryVerifier trust boundary here.
     */
    this.verified =
      verifier.verify(
        value,
        options.previous
      );

    Object.freeze(
      this
    );
  }

  get verifiedSnapshot():
    VerifiedOfficialRegistrySnapshot {
    /*
     * The verifier result and its complete snapshot graph are
     * frozen by OfficialRegistryVerifier. Returning the exact
     * authentic result allows it to serve as the predecessor
     * token for a later verified registry snapshot.
     */
    return this.verified;
  }

  get digest():
    string {
    return this.verified.digest;
  }

  get sequence():
    number {
    return this.verified
      .snapshot
      .sequence;
  }

  listPackageIds(
    options:
      OfficialRegistryCatalogQueryOptions = {}
  ): readonly string[] {
    const packageIds:
      string[] = [];

    let previousPackageId:
      string |
      undefined;

    for (
      const entry
      of this.verified
        .snapshot
        .packages
    ) {
      if (
        !entryIsVisible(
          entry,
          options
        )
      ) {
        continue;
      }

      if (
        entry.packageId ===
          previousPackageId
      ) {
        continue;
      }

      packageIds.push(
        entry.packageId
      );

      previousPackageId =
        entry.packageId;
    }

    return Object.freeze(
      packageIds
    );
  }

  hasPackage(
    packageId: string,
    options:
      OfficialRegistryCatalogQueryOptions = {}
  ): boolean {
    assertCanonicalPackageIdentifier(
      packageId
    );

    return this.verified
      .snapshot
      .packages
      .some(
        (entry) =>
          entry.packageId ===
            packageId &&
          entryIsVisible(
            entry,
            options
          )
      );
  }

  listPackageVersions(
    packageId: string,
    options:
      OfficialRegistryCatalogQueryOptions = {}
  ):
    readonly OfficialRegistryPackageEntry[] {
    assertCanonicalPackageIdentifier(
      packageId
    );

    const entries =
      this.verified
        .snapshot
        .packages
        .filter(
          (entry) =>
            entry.packageId ===
              packageId &&
            entryIsVisible(
              entry,
              options
            )
        );

    /*
     * Registry schema validation guarantees deterministic
     * package/version ordering before verification. Preserve
     * that ordering instead of re-sorting independently here.
     */
    return Object.freeze(
      entries
    );
  }

  getPackageVersion(
    packageId: string,
    version: string,
    options:
      OfficialRegistryCatalogQueryOptions = {}
  ):
    OfficialRegistryPackageEntry |
    undefined {
    assertCanonicalPackageIdentifier(
      packageId
    );

    assertCanonicalRegistryVersion(
      version
    );

    return this.verified
      .snapshot
      .packages
      .find(
        (entry) =>
          entry.packageId ===
            packageId &&
          entry.version ===
            version &&
          entryIsVisible(
            entry,
            options
          )
      );
  }

  getLatestPackageVersion(
    packageId: string,
    options:
      OfficialRegistryCatalogQueryOptions = {}
  ):
    OfficialRegistryPackageEntry |
    undefined {
    assertCanonicalPackageIdentifier(
      packageId
    );

    let latest:
      OfficialRegistryPackageEntry |
      undefined;

    for (
      const entry
      of this.verified
        .snapshot
        .packages
    ) {
      if (
        entry.packageId !==
          packageId ||
        !entryIsVisible(
          entry,
          options
        )
      ) {
        continue;
      }

      if (
        latest === undefined ||
        compareOfficialRegistryPackageEntries(
          latest,
          entry
        ) < 0
      ) {
        latest = entry;
      }
    }

    return latest;
  }
}