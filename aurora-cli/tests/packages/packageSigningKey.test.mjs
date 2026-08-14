import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
} from "node:crypto";
import test from "node:test";

import {
  encodeEd25519PublicKeySpki,
  exportEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
  fingerprintEncodedEd25519PublicKey,
  importEd25519PublicKeySpki,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  isPackageKeyId,
} from "../../dist/packages/trust/packageTrustTypes.js";

test(
  "Ed25519 package key identity is SHA-256 of canonical SPKI DER",
  () => {
    const {
      publicKey,
    } =
      generateKeyPairSync(
        "ed25519"
      );

    const der =
      exportEd25519PublicKeySpki(
        publicKey
      );

    const expected =
      createHash(
        "sha256"
      )
        .update(der)
        .digest(
          "hex"
        );

    const fingerprint =
      fingerprintEd25519PublicKey(
        publicKey
      );

    assert.equal(
      fingerprint,
      expected
    );

    assert.match(
      fingerprint,
      /^[a-f0-9]{64}$/
    );

    assert.equal(
      isPackageKeyId(
        fingerprint
      ),
      true
    );
  }
);

test(
  "Ed25519 public keys round-trip through canonical unpadded base64url SPKI",
  () => {
    const {
      publicKey,
    } =
      generateKeyPairSync(
        "ed25519"
      );

    const encoded =
      encodeEd25519PublicKeySpki(
        publicKey
      );

    assert.doesNotMatch(
      encoded,
      /=/
    );

    const imported =
      importEd25519PublicKeySpki(
        encoded
      );

    assert.equal(
      encodeEd25519PublicKeySpki(
        imported
      ),
      encoded
    );

    assert.equal(
      fingerprintEncodedEd25519PublicKey(
        encoded
      ),
      fingerprintEd25519PublicKey(
        publicKey
      )
    );
  }
);

test(
  "package key helpers reject private keys",
  () => {
    const {
      privateKey,
    } =
      generateKeyPairSync(
        "ed25519"
      );

    assert.throws(
      () =>
        fingerprintEd25519PublicKey(
          privateKey
        ),
      {
        name:
          "TypeError",
      }
    );

    assert.throws(
      () =>
        encodeEd25519PublicKeySpki(
          privateKey
        ),
      {
        name:
          "TypeError",
      }
    );
  }
);

test(
  "package key helpers reject non-Ed25519 public keys",
  () => {
    const {
      publicKey,
    } =
      generateKeyPairSync(
        "rsa",
        {
          modulusLength: 2048,
        }
      );

    assert.throws(
      () =>
        fingerprintEd25519PublicKey(
          publicKey
        ),
      {
        name:
          "TypeError",
      }
    );

    const encoded =
      Buffer.from(
        publicKey.export({
          format:
            "der",
          type:
            "spki",
        })
      ).toString(
        "base64url"
      );

    assert.throws(
      () =>
        importEd25519PublicKeySpki(
          encoded
        ),
      {
        name:
          "TypeError",
      }
    );
  }
);

test(
  "package key import rejects malformed or non-canonical base64url",
  () => {
    for (
      const value
      of [
        "",
        "not+base64url",
        "YWJjZA==",
        "***",
      ]
    ) {
      assert.throws(
        () =>
          importEd25519PublicKeySpki(
            value
          ),
        {
          name:
            "TypeError",
        }
      );
    }
  }
);

test(
  "different Ed25519 public keys have different package key identities",
  () => {
    const first =
      generateKeyPairSync(
        "ed25519"
      );

    const second =
      generateKeyPairSync(
        "ed25519"
      );

    assert.notEqual(
      fingerprintEd25519PublicKey(
        first.publicKey
      ),
      fingerprintEd25519PublicKey(
        second.publicKey
      )
    );
  }
);