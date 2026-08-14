export const PACKAGE_SIGNATURE_VERSION =
  1 as const;

export const PACKAGE_SIGNING_ALGORITHM =
  "ed25519" as const;

export const PACKAGE_PUBLIC_KEY_ENCODING =
  "spki-der-base64url" as const;

export const PACKAGE_SIGNATURE_BYTE_LENGTH =
  64 as const;

export const PACKAGE_KEY_ID_PATTERN =
  /^[a-f0-9]{64}$/;

export const PACKAGE_SIGNATURE_VALUE_PATTERN =
  /^[A-Za-z0-9_-]{86}$/;

export type PackageSigningAlgorithm =
  typeof PACKAGE_SIGNING_ALGORITHM;

export type PackagePublicKeyEncoding =
  typeof PACKAGE_PUBLIC_KEY_ENCODING;

export type PackageTrustStatus =
  "trusted" |
  "revoked";

export interface PackageSignatureEnvelope {
  readonly version:
    typeof PACKAGE_SIGNATURE_VERSION;

  readonly algorithm:
    PackageSigningAlgorithm;

  readonly keyId: string;

  readonly value: string;
}

export interface TrustedPublisherKey {
  readonly algorithm:
    PackageSigningAlgorithm;

  readonly publicKey: string;

  readonly status:
    PackageTrustStatus;

  readonly reason?: string;
}

export interface TrustedPublisher {
  readonly id: string;

  readonly status:
    PackageTrustStatus;

  readonly keys:
    readonly TrustedPublisherKey[];

  readonly reason?: string;
}

export function isPackageKeyId(
  value: string
): boolean {
  return PACKAGE_KEY_ID_PATTERN
    .test(value);
}

export function isPackageSignatureValue(
  value: string
): boolean {
  if (
    !PACKAGE_SIGNATURE_VALUE_PATTERN
      .test(value)
  ) {
    return false;
  }

  const decoded =
    Buffer.from(
      value,
      "base64url"
    );

  return (
    decoded.byteLength ===
      PACKAGE_SIGNATURE_BYTE_LENGTH &&
    decoded.toString(
      "base64url"
    ) === value
  );
}