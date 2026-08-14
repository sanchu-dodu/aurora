import assert from "node:assert/strict";

import test from "node:test";

import {
  AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID,
  AURORA_OFFICIAL_PACKAGE_SIGNING_PUBLIC_KEY,
  AURORA_OFFICIAL_PUBLISHER_ID,
  AURORA_OFFICIAL_TRUSTED_PUBLISHERS,
} from "../../dist/packages/trust/officialPublisherTrust.js";

import {
  fingerprintEncodedEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

test(
  "official Aurora publisher identity is exact",
  () => {
    assert.equal(
      AURORA_OFFICIAL_PUBLISHER_ID,
      "aurora-technologies"
    );

    assert.equal(
      AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID,
      "ef17eff013d58423f6f6968dda03c01f9ea151b2b20a6466318228945d753591"
    );

    assert.equal(
      AURORA_OFFICIAL_PACKAGE_SIGNING_PUBLIC_KEY,
      "MCowBQYDK2VwAyEAlqu_eouLNik7Bd6UgMZl3_i_iHOl0N9tVh0Ac96GWFw"
    );
  }
);

test(
  "official keyId is the SHA-256 fingerprint of the committed Ed25519 SPKI public key",
  () => {
    const derived =
      fingerprintEncodedEd25519PublicKey(
        AURORA_OFFICIAL_PACKAGE_SIGNING_PUBLIC_KEY
      );

    assert.equal(
      derived,
      AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID
    );
  }
);

test(
  "official Aurora public key resolves through PackageTrustStore",
  () => {
    const store =
      new PackageTrustStore(
        AURORA_OFFICIAL_TRUSTED_PUBLISHERS
      );

    const resolved =
      store.resolveTrustedKey(
        AURORA_OFFICIAL_PUBLISHER_ID,
        AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID
      );

    assert.equal(
      resolved.type,
      "public"
    );

    assert.equal(
      resolved.asymmetricKeyType,
      "ed25519"
    );
  }
);

test(
  "official production trust configuration is immutable",
  () => {
    assert.equal(
      Object.isFrozen(
        AURORA_OFFICIAL_TRUSTED_PUBLISHERS
      ),
      true
    );

    const publisher =
      AURORA_OFFICIAL_TRUSTED_PUBLISHERS[0];

    assert.ok(
      publisher
    );

    assert.equal(
      Object.isFrozen(
        publisher
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        publisher.keys
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        publisher.keys[0]
      ),
      true
    );
  }
);
