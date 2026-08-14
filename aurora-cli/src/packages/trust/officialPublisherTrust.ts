import {
  fingerprintEncodedEd25519PublicKey,
} from "./packageSigningKey.js";

import {
  PACKAGE_SIGNING_ALGORITHM,
  type TrustedPublisher,
  type TrustedPublisherKey,
} from "./packageTrustTypes.js";

/*
 * Aurora Package Trust production publisher identity.
 *
 * SECURITY BOUNDARY:
 *
 * This module contains PUBLIC verification material only.
 *
 * The corresponding Ed25519 private signing key must never
 * be stored in this repository, shipped in the npm package,
 * embedded in source code, or made available to package
 * execution workers.
 */

export const AURORA_OFFICIAL_PUBLISHER_ID =
  "aurora-technologies" as const;

export const AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID =
  "ef17eff013d58423f6f6968dda03c01f9ea151b2b20a6466318228945d753591" as const;

export const AURORA_OFFICIAL_PACKAGE_SIGNING_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAlqu_eouLNik7Bd6UgMZl3_i_iHOl0N9tVh0Ac96GWFw" as const;

const derivedOfficialKeyId =
  fingerprintEncodedEd25519PublicKey(
    AURORA_OFFICIAL_PACKAGE_SIGNING_PUBLIC_KEY
  );

if (
  derivedOfficialKeyId !==
  AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID
) {
  throw new Error(
    "Aurora official package signing public-key fingerprint does not match its declared keyId."
  );
}

const officialSigningKey:
  TrustedPublisherKey =
    Object.freeze({
      algorithm:
        PACKAGE_SIGNING_ALGORITHM,

      publicKey:
        AURORA_OFFICIAL_PACKAGE_SIGNING_PUBLIC_KEY,

      status:
        "trusted",
    });

const officialPublisher:
  TrustedPublisher =
    Object.freeze({
      id:
        AURORA_OFFICIAL_PUBLISHER_ID,

      status:
        "trusted",

      keys:
        Object.freeze([
          officialSigningKey,
        ]),
    });

export const AURORA_OFFICIAL_TRUSTED_PUBLISHERS:
  readonly TrustedPublisher[] =
    Object.freeze([
      officialPublisher,
    ]);
