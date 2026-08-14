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
      false;

    this.verifier =
      new PackageSignatureVerifier(
        new PackageTrustStore(
          options.trustedPublishers ??
          []
        )
      );
  }

  verify(
    manifest: PackageManifest
  ):
    PackageSignatureVerification |
    undefined {
    /*
     * Transitional Stage 1A behavior:
     *
     * Existing unsigned built-ins remain compatible
     * until Aurora establishes the official publisher
     * signing key and signs every built-in package.
     *
     * Crucially, a PRESENT signature is never ignored.
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