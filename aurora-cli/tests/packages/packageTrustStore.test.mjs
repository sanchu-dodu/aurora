import assert from "node:assert/strict";

import {
  generateKeyPairSync,
} from "node:crypto";

import test from "node:test";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

function createAuthority() {
  const {
    publicKey,
  } =
    generateKeyPairSync(
      "ed25519"
    );

  return {
    encoded:
      encodeEd25519PublicKeySpki(
        publicKey
      ),

    keyId:
      fingerprintEd25519PublicKey(
        publicKey
      ),
  };
}

function publisher(
  id,
  authority,
  overrides = {}
) {
  return {
    id,
    status: "trusted",
    keys: [
      {
        algorithm:
          "ed25519",
        publicKey:
          authority.encoded,
        status:
          "trusted",
      },
    ],
    ...overrides,
  };
}

test(
  "trust store resolves a trusted Ed25519 publisher key by cryptographic fingerprint",
  () => {
    const authority =
      createAuthority();

    const store =
      new PackageTrustStore([
        publisher(
          "aurora-tests",
          authority
        ),
      ]);

    const resolved =
      store.resolveTrustedKey(
        "aurora-tests",
        authority.keyId
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
  "trust store rejects duplicate publisher identities",
  () => {
    const first =
      createAuthority();

    const second =
      createAuthority();

    assert.throws(
      () =>
        new PackageTrustStore([
          publisher(
            "aurora-tests",
            first
          ),
          publisher(
            "aurora-tests",
            second
          ),
        ]),
      TypeError
    );
  }
);

test(
  "trust store rejects the same signing key bound to multiple publishers",
  () => {
    const authority =
      createAuthority();

    assert.throws(
      () =>
        new PackageTrustStore([
          publisher(
            "publisher-one",
            authority
          ),
          publisher(
            "publisher-two",
            authority
          ),
        ]),
      error => {
        assert.equal(
          error.name,
          "TypeError"
        );

        assert.match(
          error.message,
          /multiple publishers/
        );

        return true;
      }
    );
  }
);

test(
  "trust store rejects invalid publisher identifiers and invalid public keys",
  () => {
    const authority =
      createAuthority();

    assert.throws(
      () =>
        new PackageTrustStore([
          publisher(
            "../escape",
            authority
          ),
        ]),
      TypeError
    );

    assert.throws(
      () =>
        new PackageTrustStore([
          {
            id:
              "aurora-tests",
            status:
              "trusted",
            keys: [
              {
                algorithm:
                  "ed25519",
                publicKey:
                  "not-a-valid-key",
                status:
                  "trusted",
              },
            ],
          },
        ]),
      TypeError
    );
  }
);

test(
  "revoked publishers and keys require reasons",
  () => {
    const authority =
      createAuthority();

    assert.throws(
      () =>
        new PackageTrustStore([
          publisher(
            "aurora-tests",
            authority,
            {
              status:
                "revoked",
            }
          ),
        ]),
      TypeError
    );

    assert.throws(
      () =>
        new PackageTrustStore([
          {
            id:
              "aurora-tests",
            status:
              "trusted",
            keys: [
              {
                algorithm:
                  "ed25519",
                publicKey:
                  authority.encoded,
                status:
                  "revoked",
              },
            ],
          },
        ]),
      TypeError
    );
  }
);

test(
  "unknown publisher and publisher-key mismatch fail closed",
  () => {
    const first =
      createAuthority();

    const second =
      createAuthority();

    const store =
      new PackageTrustStore([
        publisher(
          "publisher-one",
          first
        ),
        publisher(
          "publisher-two",
          second
        ),
      ]);

    assert.throws(
      () =>
        store.resolveTrustedKey(
          "unknown-publisher",
          first.keyId
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PUBLISHER_UNTRUSTED"
        );

        return true;
      }
    );

    assert.throws(
      () =>
        store.resolveTrustedKey(
          "publisher-one",
          second.keyId
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

test(
  "revoked publisher fails closed",
  () => {
    const authority =
      createAuthority();

    const store =
      new PackageTrustStore([
        publisher(
          "aurora-tests",
          authority,
          {
            status:
              "revoked",
            reason:
              "Publisher trust removed.",
          }
        ),
      ]);

    assert.throws(
      () =>
        store.resolveTrustedKey(
          "aurora-tests",
          authority.keyId
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

test(
  "revoked signing key has a distinct failure code",
  () => {
    const authority =
      createAuthority();

    const store =
      new PackageTrustStore([
        {
          id:
            "aurora-tests",
          status:
            "trusted",
          keys: [
            {
              algorithm:
                "ed25519",
              publicKey:
                authority.encoded,
              status:
                "revoked",
              reason:
                "Key compromise test.",
            },
          ],
        },
      ]);

    assert.throws(
      () =>
        store.resolveTrustedKey(
          "aurora-tests",
          authority.keyId
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_SIGNING_KEY_REVOKED"
        );

        return true;
      }
    );
  }
);