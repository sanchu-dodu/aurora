import assert from "node:assert/strict";

import {
  generateKeyPairSync,
  sign as signSignature,
} from "node:crypto";

import test from "node:test";

import {
  validatePackage,
} from "../../dist/packages/packageValidator.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  PackageSignatureVerifier,
} from "../../dist/packages/trust/packageSignatureVerifier.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

const PUBLISHER_ID =
  "aurora-rotation-tests";

function createAuthority() {
  const {
    privateKey,
    publicKey,
  } =
    generateKeyPairSync(
      "ed25519"
    );

  return {
    privateKey,

    publicKey:
      encodeEd25519PublicKeySpki(
        publicKey
      ),

    keyId:
      fingerprintEd25519PublicKey(
        publicKey
      ),
  };
}

function createUnsignedManifest(
  id
) {
  return createManifestV1({
    id,

    publisher: {
      id:
        PUBLISHER_ID,

      name:
        "Aurora Rotation Tests",

      url:
        "https://example.com/aurora-rotation-tests",
    },
  });
}

function signManifest(
  manifest,
  authority
) {
  const draft = {
    ...manifest,

    signature: {
      version: 1,
      algorithm:
        "ed25519",
      keyId:
        authority.keyId,
      value:
        "",
    },
  };

  const value =
    signSignature(
      null,
      createPackageSigningPayload(
        draft
      ),
      authority.privateKey
    ).toString(
      "base64url"
    );

  return validatePackage(
    {
      ...draft,

      signature: {
        ...draft.signature,
        value,
      },
    },
    "rotation test manifest"
  );
}

function trustedKey(
  authority
) {
  return {
    algorithm:
      "ed25519",

    publicKey:
      authority.publicKey,

    status:
      "trusted",
  };
}

function createVerifier(
  keys
) {
  return new PackageSignatureVerifier(
    new PackageTrustStore([
      {
        id:
          PUBLISHER_ID,

        status:
          "trusted",

        keys,
      },
    ])
  );
}

test(
  "key rotation supports a trusted overlap window",
  () => {
    const previous =
      createAuthority();

    const replacement =
      createAuthority();

    const previousManifest =
      signManifest(
        createUnsignedManifest(
          "rotation-previous"
        ),
        previous
      );

    const replacementManifest =
      signManifest(
        createUnsignedManifest(
          "rotation-replacement"
        ),
        replacement
      );

    const verifier =
      createVerifier([
        trustedKey(
          previous
        ),

        trustedKey(
          replacement
        ),
      ]);

    assert.equal(
      verifier.verify(
        previousManifest
      ).keyId,
      previous.keyId
    );

    assert.equal(
      verifier.verify(
        replacementManifest
      ).keyId,
      replacement.keyId
    );

    assert.notEqual(
      previous.keyId,
      replacement.keyId
    );
  }
);

test(
  "revoked previous key fails while the replacement remains trusted",
  () => {
    const previous =
      createAuthority();

    const replacement =
      createAuthority();

    const previousManifest =
      signManifest(
        createUnsignedManifest(
          "revoked-previous"
        ),
        previous
      );

    const replacementManifest =
      signManifest(
        createUnsignedManifest(
          "active-replacement"
        ),
        replacement
      );

    const verifier =
      createVerifier([
        {
          algorithm:
            "ed25519",

          publicKey:
            previous.publicKey,

          status:
            "revoked",

          reason:
            "Rotation migration completed.",
        },

        trustedKey(
          replacement
        ),
      ]);

    assert.throws(
      () =>
        verifier.verify(
          previousManifest
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_SIGNING_KEY_REVOKED"
        );

        return true;
      }
    );

    assert.equal(
      verifier.verify(
        replacementManifest
      ).keyId,
      replacement.keyId
    );
  }
);

test(
  "removing a retired key loses the distinct revoked-key signal",
  () => {
    const previous =
      createAuthority();

    const replacement =
      createAuthority();

    const previousManifest =
      signManifest(
        createUnsignedManifest(
          "removed-previous"
        ),
        previous
      );

    const verifier =
      createVerifier([
        trustedKey(
          replacement
        ),
      ]);

    assert.throws(
      () =>
        verifier.verify(
          previousManifest
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PUBLISHER_UNTRUSTED"
        );

        return true;
      }
    );
  }
);
