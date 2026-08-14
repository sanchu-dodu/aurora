import {
  verify as verifySignature,
} from "node:crypto";

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
  createPackageSigningPayload,
} from "./packageSigningPayload.js";

import {
  PACKAGE_SIGNATURE_VERSION,
  PACKAGE_SIGNING_ALGORITHM,
  isPackageKeyId,
  isPackageSignatureValue,
} from "./packageTrustTypes.js";

import {
  PackageTrustStore,
} from "./packageTrustStore.js";

export interface PackageSignatureVerification {
  readonly publisherId:
    string;

  readonly keyId:
    string;

  readonly algorithm:
    typeof PACKAGE_SIGNING_ALGORITHM;
}

export class PackageSignatureVerifier {
  constructor(
    private readonly trustStore:
      PackageTrustStore
  ) {}

  verify(
    manifest: PackageManifest
  ): PackageSignatureVerification {
    const signature =
      manifest.signature;

    if (!signature) {
      throw new AuroraError(
        `Package '${manifest.id}' does not contain a trusted package signature.`,
        {
          code:
            ErrorCodes
              .PACKAGE_SIGNATURE_REQUIRED,
          suggestion:
            "Use a signed package whose publisher key is trusted by Aurora.",
        }
      );
    }

    /*
     * Defense in depth:
     * PackageManifest should already have passed ManifestSchema,
     * but trust verification does not rely exclusively on the
     * TypeScript type assertion.
     */
    if (
      signature.version !==
        PACKAGE_SIGNATURE_VERSION ||
      signature.algorithm !==
        PACKAGE_SIGNING_ALGORITHM ||
      !isPackageKeyId(
        signature.keyId
      ) ||
      !isPackageSignatureValue(
        signature.value
      )
    ) {
      throw invalidSignature(
        manifest.id
      );
    }

    const publicKey =
      this.trustStore
        .resolveTrustedKey(
          manifest.publisher.id,
          signature.keyId
        );

    const payload =
      createPackageSigningPayload(
        manifest
      );

    const signatureBytes =
      Buffer.from(
        signature.value,
        "base64url"
      );

    let valid = false;

    try {
      valid =
        verifySignature(
          null,
          payload,
          publicKey,
          signatureBytes
        );
    }
    catch {
      throw invalidSignature(
        manifest.id
      );
    }

    if (!valid) {
      throw invalidSignature(
        manifest.id
      );
    }

    return {
      publisherId:
        manifest.publisher.id,
      keyId:
        signature.keyId,
      algorithm:
        PACKAGE_SIGNING_ALGORITHM,
    };
  }
}

function invalidSignature(
  packageId: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' signature verification failed.`,
    {
      code:
        ErrorCodes
          .PACKAGE_SIGNATURE_INVALID,
      suggestion:
        "Reject the package and obtain an untampered package signed by a trusted publisher key.",
    }
  );
}