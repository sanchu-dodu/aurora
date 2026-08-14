import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  PackageSignatureVerifier,
  type PackageSignatureVerification,
} from "./packageSignatureVerifier.js";

import {
  PackageTrustStore,
} from "./packageTrustStore.js";

import {
  AURORA_OFFICIAL_TRUSTED_PUBLISHERS,
} from "./officialPublisherTrust.js";

import type {
  TrustedPublisher,
} from "./packageTrustTypes.js";

export interface PackageTrustPolicyOptions {
  readonly requireSignatures?:
    boolean;

  readonly trustedPublishers?:
    readonly TrustedPublisher[];
}

export class PackageTrustPolicy {
  private readonly requireSignatures:
    boolean;

  private readonly verifier:
    PackageSignatureVerifier;

  constructor(
    options:
      PackageTrustPolicyOptions = {}
  ) {
    this.requireSignatures =
      options.requireSignatures ??
      true;

    this.verifier =
      new PackageSignatureVerifier(
        new PackageTrustStore(
          options.trustedPublishers ??
          AURORA_OFFICIAL_TRUSTED_PUBLISHERS
        )
      );
  }

  verify(
    manifest: PackageManifest
  ):
    PackageSignatureVerification |
    undefined {
    /*
     * Stage 1B enforcement:
     *
     * Aurora's official publisher verification key is
     * trusted by default and package signatures are required
     * by default.
     *
     * Controlled callers may explicitly set
     * requireSignatures=false for legacy compatibility, but
     * a PRESENT signature is never ignored and must always
     * authenticate against the active trust store.
     * Signed packages must always authenticate against
     * the active trust store.
     */
    if (
      !manifest.signature &&
      !this.requireSignatures
    ) {
      return undefined;
    }

    return this.verifier.verify(
      manifest
    );
  }
}
