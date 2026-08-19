import assert from "node:assert/strict";

import {
  generateKeyPairSync,
  sign,
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

function createAuthority() {
  const {
    publicKey,
    privateKey,
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

function trustedPublisher(
  id,
  authority,
  overrides = {}
) {
  return {
    id,
    status:
      "trusted",
    keys: [
      {
        algorithm:
          "ed25519",
        publicKey:
          authority.publicKey,
        status:
          "trusted",
      },
    ],
    ...overrides,
  };
}

function createVerifier(
  publishers
) {
  return new PackageSignatureVerifier(
    new PackageTrustStore(
      publishers
    )
  );
}

function signManifest(
  authority,
  overrides = {},
  signingKey =
    authority.privateKey
) {
  const unsigned =
    validatePackage(
      createManifestV1(
        overrides
      ),
      "unsigned test manifest"
    );

  const envelope = {
    version: 1,
    algorithm:
      "ed25519",
    keyId:
      authority.keyId,
    value:
      "",
  };

  const candidate = {
    ...unsigned,
    signature:
      envelope,
  };

  const signature =
    sign(
      null,
      createPackageSigningPayload(
        candidate
      ),
      signingKey
    ).toString(
      "base64url"
    );

  return validatePackage(
    {
      ...candidate,
      signature: {
        ...envelope,
        value:
          signature,
      },
    },
    "signed test manifest"
  );
}

test(
  "Manifest v1 remains backward-compatible with unsigned packages during Stage 1A",
  () => {
    const manifest =
      validatePackage(
        createManifestV1(),
        "unsigned compatibility"
      );

    assert.equal(
      manifest.signature,
      undefined
    );
  }
);

test(
  "Manifest v1 accepts a canonical Ed25519 signature envelope",
  () => {
    const authority =
      createAuthority();

    const manifest =
      signManifest(
        authority
      );

    assert.equal(
      manifest.signature
        .version,
      1
    );

    assert.equal(
      manifest.signature
        .algorithm,
      "ed25519"
    );

    assert.equal(
      manifest.signature
        .keyId,
      authority.keyId
    );

    assert.equal(
      Buffer.from(
        manifest.signature
          .value,
        "base64url"
      ).byteLength,
      64
    );
  }
);

test(
  "Manifest v1 rejects malformed or ambiguous signature envelopes",
  () => {
    const base =
      createManifestV1();

    const invalidSignatures = [
      {
        version: 2,
        algorithm:
          "ed25519",
        keyId:
          "a".repeat(64),
        value:
          "a".repeat(86),
      },
      {
        version: 1,
        algorithm:
          "rsa",
        keyId:
          "a".repeat(64),
        value:
          "a".repeat(86),
      },
      {
        version: 1,
        algorithm:
          "ed25519",
        keyId:
          "A".repeat(64),
        value:
          "a".repeat(86),
      },
      {
        version: 1,
        algorithm:
          "ed25519",
        keyId:
          "a".repeat(64),
        value:
          "not-a-signature",
      },
      {
        version: 1,
        algorithm:
          "ed25519",
        keyId:
          "a".repeat(64),
        value:
          "a".repeat(86),
        extra:
          true,
      },
    ];

    for (
      const signature
      of invalidSignatures
    ) {
      assert.throws(
        () =>
          validatePackage(
            {
              ...base,
              signature,
            },
            "invalid signature schema"
          ),
        error => {
          assert.equal(
            error.code,
            "INVALID_PACKAGE_MANIFEST"
          );

          return true;
        }
      );
    }
  }
);

test(
  "valid signature from a trusted publisher verifies",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority
        ),
      ]);

    const manifest =
      signManifest(
        authority
      );

    const result =
      verifier.verify(
        manifest
      );

    assert.deepEqual(
      result,
      {
        publisherId:
          "aurora-tests",
        keyId:
          authority.keyId,
        algorithm:
          "ed25519",
      }
    );
  }
);

test(
  "signature verifier requires a signature when invoked",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority
        ),
      ]);

    const manifest =
      validatePackage(
        createManifestV1(),
        "unsigned verifier test"
      );

    assert.throws(
      () =>
        verifier.verify(
          manifest
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_SIGNATURE_REQUIRED"
        );

        return true;
      }
    );
  }
);

test(
  "manifest security fields are cryptographically bound",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority
        ),
      ]);

    const signed =
      signManifest(
        authority
      );

    const tampered = [
      {
        ...signed,
        version:
          "1.0.1",
      },
      {
        ...signed,
        description:
          "Tampered description.",
      },
      {
        ...signed,
        artifact: {
          ...signed.artifact,
          digest:
            "b".repeat(64),
        },
      },
      {
        ...signed,
        provenance: {
          ...signed.provenance,
          reference:
            "tampered-reference",
        },
      },
      {
        ...signed,
        capabilities: [
          "project.files.write",
        ],
      },
      {
        ...signed,
        lifecycle: {
          ...signed.lifecycle,
          deprecated:
            true,
          reason:
            "Tampered lifecycle.",
        },
      },
    ];

    for (
      const candidate
      of tampered
    ) {
      const validated =
        validatePackage(
          candidate,
          "tampered signed manifest"
        );

      assert.throws(
        () =>
          verifier.verify(
            validated
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNATURE_INVALID"
          );

          return true;
        }
      );
    }
  }
);

test(
  "modifying signature bytes fails cryptographic verification",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority
        ),
      ]);

    const manifest =
      signManifest(
        authority
      );

    const bytes =
      Buffer.from(
        manifest.signature
          .value,
        "base64url"
      );

    bytes[0] ^=
      0x01;

    const tampered =
      validatePackage(
        {
          ...manifest,
          signature: {
            ...manifest.signature,
            value:
              bytes.toString(
                "base64url"
              ),
          },
        },
        "tampered signature bytes"
      );

    assert.throws(
      () =>
        verifier.verify(
          tampered
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_SIGNATURE_INVALID"
        );

        return true;
      }
    );
  }
);

test(
  "signature produced by the wrong private key fails",
  () => {
    const trusted =
      createAuthority();

    const attacker =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          trusted
        ),
      ]);

    const forged =
      signManifest(
        trusted,
        {},
        attacker.privateKey
      );

    assert.throws(
      () =>
        verifier.verify(
          forged
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_SIGNATURE_INVALID"
        );

        return true;
      }
    );
  }
);

test(
  "changing publisher identity fails trust binding before execution",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority
        ),
      ]);

    const signed =
      signManifest(
        authority
      );

    const tampered =
      validatePackage(
        {
          ...signed,
          publisher: {
            ...signed.publisher,
            id:
              "other-publisher",
          },
        },
        "publisher tamper"
      );

    assert.throws(
      () =>
        verifier.verify(
          tampered
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
  "a key trusted for another publisher cannot authorize this publisher",
  () => {
    const first =
      createAuthority();

    const second =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          first
        ),
        trustedPublisher(
          "other-publisher",
          second
        ),
      ]);

    const signed =
      signManifest(
        first
      );

    const mismatched =
      validatePackage(
        {
          ...signed,
          signature: {
            ...signed.signature,
            keyId:
              second.keyId,
          },
        },
        "publisher key mismatch"
      );

    assert.throws(
      () =>
        verifier.verify(
          mismatched
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
  "revoked signing key fails with its distinct trust error",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
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
                authority.publicKey,
              status:
                "revoked",
              reason:
                "Test key revocation.",
            },
          ],
        },
      ]);

    const signed =
      signManifest(
        authority
      );

    assert.throws(
      () =>
        verifier.verify(
          signed
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

test(
  "revoked publisher fails trust verification",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority,
          {
            status:
              "revoked",
            reason:
              "Publisher revoked for test.",
          }
        ),
      ]);

    const signed =
      signManifest(
        authority
      );

    assert.throws(
      () =>
        verifier.verify(
          signed
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
  "object property insertion order does not affect verified signatures",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier([
        trustedPublisher(
          "aurora-tests",
          authority
        ),
      ]);

    const signed =
      signManifest(
        authority
      );

    const reordered =
      validatePackage(
        {
          links:
            signed.links,
          lifecycle:
            signed.lifecycle,
          platforms:
            signed.platforms,
          environment:
            signed.environment,
          migrations:
            signed.migrations,
          files:
            signed.files,
          capabilities:
            signed.capabilities,
          conflicts:
            signed.conflicts,
          dependencies:
            signed.dependencies,
          provenance:
            signed.provenance,
          artifact:
            signed.artifact,
          signature:
            signed.signature,
          publisher:
            signed.publisher,
          compatibility:
            signed.compatibility,
          frameworks:
            signed.frameworks,
          tags:
            signed.tags,
          category:
            signed.category,
          description:
            signed.description,
          version:
            signed.version,
          name:
            signed.name,
          id:
            signed.id,
          kind:
            signed.kind,
          manifestVersion:
            signed.manifestVersion,
        },
        "reordered signed manifest"
      );

    assert.doesNotThrow(
      () =>
        verifier.verify(
          reordered
        )
    );
  }
);