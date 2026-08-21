import assert from "node:assert/strict";

import {
  generateKeyPairSync,
  sign,
} from "node:crypto";

import test from "node:test";

import {
  AURORA_OFFICIAL_PUBLISHER_ID,
} from "../../dist/packages/trust/officialPublisherTrust.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  PACKAGE_SIGNING_DOMAIN,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

import {
  OFFICIAL_REGISTRY_SIGNING_DOMAIN,
  calculateOfficialRegistrySnapshotDigest,
  createOfficialRegistrySigningPayload,
} from "../../dist/packages/registry/officialRegistrySigningPayload.js";

import {
  OfficialRegistryVerifier,
} from "../../dist/packages/registry/officialRegistryVerifier.js";

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

function createTrustStore(
  authority,
  {
    publisherStatus =
      "trusted",

    keyStatus =
      "trusted",
  } = {}
) {
  const publisher = {
    id:
      AURORA_OFFICIAL_PUBLISHER_ID,

    status:
      publisherStatus,

    keys: [
      {
        algorithm:
          "ed25519",

        publicKey:
          authority.publicKey,

        status:
          keyStatus,

        ...(
          keyStatus ===
            "revoked"
            ? {
                reason:
                  "Test signing-key revocation.",
              }
            : {}
        ),
      },
    ],

    ...(
      publisherStatus ===
        "revoked"
        ? {
            reason:
              "Test publisher revocation.",
          }
        : {}
    ),
  };

  return new PackageTrustStore([
    publisher,
  ]);
}

function createVerifier(
  authority,
  options
) {
  return new OfficialRegistryVerifier({
    trustStore:
      createTrustStore(
        authority,
        options
      ),
  });
}

function createEntry(
  packageId =
    "alpha",
  version =
    "1.0.0",
  overrides = {}
) {
  const archiveOverrides =
    overrides.archive ?? {};

  const provenanceOverrides =
    overrides.provenance ?? {};

  const lifecycleOverrides =
    overrides.lifecycle ?? {};

  const status =
    lifecycleOverrides.status ??
    "active";

  const lifecycle =
    status === "revoked"
      ? {
          status:
            "revoked",

          reason:
            lifecycleOverrides.reason ??
            "Registry package version revoked for test.",
        }
      : {
          status:
            "active",
        };

  return {
    packageId,

    version,

    manifestDigest:
      "1".repeat(64),

    archive: {
      algorithm:
        "sha256",

      digest:
        "2".repeat(64),

      size:
        1024,

      url:
        `https://registry.aurora.example/packages/${packageId}/${version}.tgz`,

      ...archiveOverrides,
    },

    provenance: {
      type:
        "source",

      url:
        "https://github.com/sanchu-dodu/aurora",

      reference:
        `${packageId}@${version}`,

      ...provenanceOverrides,
    },

    lifecycle,

    ...Object.fromEntries(
      Object.entries(
        overrides
      ).filter(
        ([key]) =>
          ![
            "archive",
            "provenance",
            "lifecycle",
          ].includes(key)
      )
    ),
  };
}

function cloneEntry(
  entry,
  overrides = {}
) {
  const lifecycle =
    overrides.lifecycle !==
      undefined
      ? overrides.lifecycle
      : {
          ...entry.lifecycle,
        };

  return {
    ...entry,
    ...overrides,

    archive: {
      ...entry.archive,
      ...(
        overrides.archive ??
        {}
      ),
    },

    provenance: {
      ...entry.provenance,
      ...(
        overrides.provenance ??
        {}
      ),
    },

    lifecycle: {
      ...lifecycle,
    },
  };
}

function signSnapshot(
  authority,
  overrides = {},
  signingKey =
    authority.privateKey
) {
  const base = {
    registryVersion: 1,

    kind:
      "aurora-official-package-registry",

    sequence: 1,

    publishedAt:
      "2026-08-21T10:00:00.000Z",

    previousSnapshotDigest:
      null,

    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,

    packages: [
      createEntry(),
    ],

    signature: {
      version: 1,

      algorithm:
        "ed25519",

      keyId:
        authority.keyId,

      value:
        "A".repeat(86),
    },
  };

  const candidate = {
    ...base,
    ...overrides,

    signature: {
      ...base.signature,
      ...(
        overrides.signature ??
        {}
      ),
    },
  };

  const signature =
    sign(
      null,
      createOfficialRegistrySigningPayload(
        candidate
      ),
      signingKey
    ).toString(
      "base64url"
    );

  return {
    ...candidate,

    signature: {
      ...candidate.signature,
      value:
        signature,
    },
  };
}

function createSuccessor(
  authority,
  previous,
  packages,
  overrides = {}
) {
  return signSnapshot(
    authority,
    {
      sequence:
        previous.snapshot.sequence +
        1,

      publishedAt:
        "2026-08-21T10:01:00.000Z",

      previousSnapshotDigest:
        previous.digest,

      packages,

      ...overrides,
    }
  );
}

test(
  "valid signed genesis registry snapshot verifies and is deeply frozen",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const source =
      signSnapshot(
        authority
      );

    const verified =
      verifier.verify(
        source
      );

    assert.equal(
      verified.snapshot.sequence,
      1
    );

    assert.equal(
      verified.digest,
      calculateOfficialRegistrySnapshotDigest(
        verified.snapshot
      )
    );

    assert.equal(
      Object.isFrozen(
        verified
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot.packages
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot.packages[0]
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot.packages[0]
          .archive
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot.packages[0]
          .provenance
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot.packages[0]
          .lifecycle
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        verified.snapshot.signature
      ),
      true
    );

    assert.throws(
      () => {
        verified.snapshot
          .packages[0]
          .archive.url =
            "https://attacker.example/replaced.tgz";
      },
      TypeError
    );

    source.packages[0]
      .archive.url =
        "https://caller.example/changed.tgz";

    assert.equal(
      verified.snapshot.packages[0]
        .archive.url,
      "https://registry.aurora.example/packages/alpha/1.0.0.tgz"
    );
  }
);

test(
  "valid append-only successor may add a new package version",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const genesis =
      verifier.verify(
        signSnapshot(
          authority
        )
      );

    const successor =
      createSuccessor(
        authority,
        genesis,
        [
          createEntry(
            "alpha",
            "1.0.0"
          ),

          createEntry(
            "alpha",
            "1.1.0",
            {
              manifestDigest:
                "3".repeat(64),

              archive: {
                digest:
                  "4".repeat(64),

                size:
                  2048,
              },
            }
          ),
        ]
      );

    const verified =
      verifier.verify(
        successor,
        genesis
      );

    assert.equal(
      verified.snapshot.sequence,
      2
    );

    assert.equal(
      verified.snapshot.packages.length,
      2
    );
  }
);

test(
  "tampering with signed registry metadata fails cryptographic verification",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const signed =
      signSnapshot(
        authority
      );

    const tampered = {
      ...signed,

      packages: [
        cloneEntry(
          signed.packages[0],
          {
            archive: {
              digest:
                "9".repeat(64),
            },
          }
        ),
      ],
    };

    assert.throws(
      () =>
        verifier.verify(
          tampered
        )
    );
  }
);

test(
  "registry signature produced by the wrong private key is rejected",
  () => {
    const trusted =
      createAuthority();

    const attacker =
      createAuthority();

    const verifier =
      createVerifier(
        trusted
      );

    const forged =
      signSnapshot(
        trusted,
        {},
        attacker.privateKey
      );

    assert.throws(
      () =>
        verifier.verify(
          forged
        ),
      /signature verification failed/
    );
  }
);

test(
  "untrusted, revoked-key, and revoked-publisher signers are rejected",
  () => {
    const authority =
      createAuthority();

    const otherAuthority =
      createAuthority();

    const signed =
      signSnapshot(
        authority
      );

    assert.throws(
      () =>
        createVerifier(
          otherAuthority
        ).verify(
          signed
        )
    );

    assert.throws(
      () =>
        createVerifier(
          authority,
          {
            keyStatus:
              "revoked",
          }
        ).verify(
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

    assert.throws(
      () =>
        createVerifier(
          authority,
          {
            publisherStatus:
              "revoked",
          }
        ).verify(
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
  "existing package manifest, archive, and provenance identity cannot be rewritten",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const genesis =
      verifier.verify(
        signSnapshot(
          authority
        )
      );

    const original =
      genesis.snapshot.packages[0];

    const rewrites = [
      cloneEntry(
        original,
        {
          manifestDigest:
            "a".repeat(64),
        }
      ),

      cloneEntry(
        original,
        {
          archive: {
            digest:
              "b".repeat(64),
          },
        }
      ),

      cloneEntry(
        original,
        {
          archive: {
            size:
              4096,
          },
        }
      ),

      cloneEntry(
        original,
        {
          archive: {
            url:
              "https://registry.aurora.example/packages/alpha/replaced.tgz",
          },
        }
      ),

      cloneEntry(
        original,
        {
          provenance: {
            reference:
              "different-build",
          },
        }
      ),
    ];

    for (
      const rewritten
      of rewrites
    ) {
      const successor =
        createSuccessor(
          authority,
          genesis,
          [
            rewritten,
          ]
        );

      assert.throws(
        () =>
          verifier.verify(
            successor,
            genesis
          ),
        /immutable/
      );
    }
  }
);

test(
  "append-only registry rejects deletion of an existing package version",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const genesis =
      verifier.verify(
        signSnapshot(
          authority
        )
      );

    const successor =
      createSuccessor(
        authority,
        genesis,
        []
      );

    assert.throws(
      () =>
        verifier.verify(
          successor,
          genesis
        ),
      /cannot disappear/
    );
  }
);

test(
  "snapshot chain rejects sequence gaps, incorrect predecessor digests, and backwards timestamps",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const genesis =
      verifier.verify(
        signSnapshot(
          authority
        )
      );

    const entries = [
      createEntry(),
    ];

    const sequenceGap =
      createSuccessor(
        authority,
        genesis,
        entries,
        {
          sequence: 3,
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          sequenceGap,
          genesis
        ),
      /sequence must advance exactly/
    );

    const wrongDigest =
      createSuccessor(
        authority,
        genesis,
        entries,
        {
          previousSnapshotDigest:
            "f".repeat(64),
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          wrongDigest,
          genesis
        ),
      /previousSnapshotDigest/
    );

    const backwards =
      createSuccessor(
        authority,
        genesis,
        entries,
        {
          publishedAt:
            "2026-08-21T09:59:59.000Z",
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          backwards,
          genesis
        ),
      /cannot move backwards/
    );
  }
);

test(
  "revocation is accepted once and cannot be removed or rewritten",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const genesis =
      verifier.verify(
        signSnapshot(
          authority
        )
      );

    const original =
      genesis.snapshot.packages[0];

    const revokedEntry =
      cloneEntry(
        original,
        {
          lifecycle: {
            status:
              "revoked",

            reason:
              "Security incident 2026-08.",
          },
        }
      );

    const revokedSnapshot =
      createSuccessor(
        authority,
        genesis,
        [
          revokedEntry,
        ]
      );

    const verifiedRevoked =
      verifier.verify(
        revokedSnapshot,
        genesis
      );

    assert.equal(
      verifiedRevoked.snapshot
        .packages[0]
        .lifecycle.status,
      "revoked"
    );

    const activeAgain =
      signSnapshot(
        authority,
        {
          sequence: 3,

          publishedAt:
            "2026-08-21T10:02:00.000Z",

          previousSnapshotDigest:
            verifiedRevoked.digest,

          packages: [
            cloneEntry(
              original,
              {
                lifecycle: {
                  status:
                    "active",
                },
              }
            ),
          ],
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          activeAgain,
          verifiedRevoked
        ),
      /cannot be reactivated/
    );

    const rewrittenReason =
      signSnapshot(
        authority,
        {
          sequence: 3,

          publishedAt:
            "2026-08-21T10:02:00.000Z",

          previousSnapshotDigest:
            verifiedRevoked.digest,

          packages: [
            cloneEntry(
              revokedEntry,
              {
                lifecycle: {
                  status:
                    "revoked",

                  reason:
                    "Different reason.",
                },
              }
            ),
          ],
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          rewrittenReason,
          verifiedRevoked
        ),
      /revocation rewritten/
    );
  }
);

test(
  "schema rejects unknown fields, duplicate versions, and non-deterministic package ordering",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const unknownField =
      signSnapshot(
        authority,
        {
          unexpected:
            true,
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          unknownField
        )
    );

    const duplicate =
      signSnapshot(
        authority,
        {
          packages: [
            createEntry(
              "alpha",
              "1.0.0"
            ),

            createEntry(
              "alpha",
              "1.0.0"
            ),
          ],
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          duplicate
        )
    );

    const unsorted =
      signSnapshot(
        authority,
        {
          packages: [
            createEntry(
              "beta",
              "1.0.0"
            ),

            createEntry(
              "alpha",
              "1.0.0"
            ),
          ],
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          unsorted
        )
    );
  }
);

test(
  "non-genesis snapshot cannot be verified without its authenticated predecessor",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const nonGenesis =
      signSnapshot(
        authority,
        {
          sequence: 2,

          previousSnapshotDigest:
            "a".repeat(64),
        }
      );

    assert.throws(
      () =>
        verifier.verify(
          nonGenesis
        ),
      /requires a previously verified snapshot/
    );
  }
);

test(
  "fabricated predecessor records cannot cross the verifier trust boundary",
  () => {
    const authority =
      createAuthority();

    const verifier =
      createVerifier(
        authority
      );

    const genesis =
      verifier.verify(
        signSnapshot(
          authority
        )
      );

    const successor =
      createSuccessor(
        authority,
        genesis,
        [
          createEntry(),
        ]
      );

    const fabricated = {
      snapshot:
        genesis.snapshot,

      digest:
        genesis.digest,
    };

    assert.throws(
      () =>
        verifier.verify(
          successor,
          fabricated
        ),
      /was not produced by the official registry verifier/
    );
  }
);

test(
  "registry signing payload is domain-separated from package-manifest signatures",
  () => {
    assert.notEqual(
      OFFICIAL_REGISTRY_SIGNING_DOMAIN,
      PACKAGE_SIGNING_DOMAIN
    );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority
      );

    const payload =
      createOfficialRegistrySigningPayload(
        snapshot
      );

    const expectedPrefix =
      Buffer.from(
        `${OFFICIAL_REGISTRY_SIGNING_DOMAIN}\0`,
        "utf8"
      );

    assert.deepEqual(
      payload.subarray(
        0,
        expectedPrefix.length
      ),
      expectedPrefix
    );
  }
);

test(
  "snapshot digest binds the complete signed snapshot including signature bytes",
  () => {
    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority
      );

    const digest =
      calculateOfficialRegistrySnapshotDigest(
        snapshot
      );

    const signatureBytes =
      Buffer.from(
        snapshot.signature.value,
        "base64url"
      );

    signatureBytes[0] ^=
      0x01;

    const changedSignature = {
      ...snapshot,

      signature: {
        ...snapshot.signature,

        value:
          signatureBytes.toString(
            "base64url"
          ),
      },
    };

    assert.notEqual(
      calculateOfficialRegistrySnapshotDigest(
        changedSignature
      ),
      digest
    );
  }
);