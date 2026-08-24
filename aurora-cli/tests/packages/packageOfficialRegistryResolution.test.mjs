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
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

import {
  createOfficialRegistrySigningPayload,
} from "../../dist/packages/registry/officialRegistrySigningPayload.js";

import {
  OfficialRegistryResolver,
} from "../../dist/packages/registry/officialRegistryResolver.js";

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

function createVerifierOptions(
  authority
) {
  return {
    trustStore:
      new PackageTrustStore([
        {
          id:
            AURORA_OFFICIAL_PUBLISHER_ID,

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
        },
      ]),
  };
}

function createEntry(
  packageId,
  version,
  {
    lifecycle = {
      status:
        "active",
    },
    manifestDigest =
      "1".repeat(64),
    archiveDigest =
      "2".repeat(64),
  } = {}
) {
  return {
    packageId,
    version,
    manifestDigest,

    archive: {
      algorithm:
        "sha256",

      digest:
        archiveDigest,

      size:
        1024,

      url:
        `https://registry.aurora.example/packages/${packageId}/${version}.tgz`,
    },

    provenance: {
      type:
        "build",

      url:
        "https://github.com/sanchu-dodu/aurora",

      reference:
        `${packageId}@${version}`,
    },

    lifecycle,
  };
}

function createRevokedEntry(
  packageId,
  version,
  reason =
    "Package revoked for resolution test."
) {
  return createEntry(
    packageId,
    version,
    {
      lifecycle: {
        status:
          "revoked",

        reason,
      },
    }
  );
}

function signSnapshot(
  authority,
  overrides = {}
) {
  const base = {
    registryVersion:
      1,

    kind:
      "aurora-official-package-registry",

    sequence:
      1,

    publishedAt:
      "2026-08-24T10:15:00.000Z",

    previousSnapshotDigest:
      null,

    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,

    packages: [
      createEntry(
        "alpha",
        "1.0.0"
      ),
    ],

    signature: {
      version:
        1,

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
      authority.privateKey
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

function createResolver(
  authority,
  snapshot,
  options = {}
) {
  return new OfficialRegistryResolver(
    snapshot,
    {
      verifierOptions:
        createVerifierOptions(
          authority
        ),

      ...options,
    }
  );
}

function createSuccessor(
  authority,
  previous,
  packages
) {
  return signSnapshot(
    authority,
    {
      sequence:
        previous.snapshot.sequence +
        1,

      publishedAt:
        "2026-08-24T10:16:00.000Z",

      previousSnapshotDigest:
        previous.digest,

      packages,
    }
  );
}

test(
  "resolver verifies registry authenticity before selecting a package",
  () => {
    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority
      );

    snapshot.packages[0]
      .archive
      .digest =
        "9".repeat(64);

    assert.throws(
      () =>
        createResolver(
          authority,
          snapshot
        ),
      /Official package registry verification failed/
    );
  }
);

test(
  "exact resolution returns the immutable authenticated artifact identity",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
        signSnapshot(
          authority
        )
      );

    const resolved =
      resolver.resolve(
        "alpha",
        {
          kind:
            "exact",

          version:
            "1.0.0",
        }
      );

    assert.equal(
      resolved.entry.packageId,
      "alpha"
    );

    assert.equal(
      resolved.entry.version,
      "1.0.0"
    );

    assert.equal(
      resolved.registryDigest,
      resolver.digest
    );

    assert.equal(
      resolved.registrySequence,
      resolver.sequence
    );

    assert.equal(
      Object.isFrozen(
        resolver
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        resolved
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        resolved.entry.archive
      ),
      true
    );

    assert.throws(
      () => {
        resolved.entry
          .archive
          .digest =
            "f".repeat(64);
      },
      TypeError
    );
  }
);

test(
  "exact resolution preserves build metadata identity",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
        signSnapshot(
          authority,
          {
            packages: [
              createEntry(
                "alpha",
                "1.0.0+aaa"
              ),

              createEntry(
                "alpha",
                "1.0.0+bbb"
              ),
            ],
          }
        )
      );

    assert.equal(
      resolver.resolve(
        "alpha",
        {
          kind:
            "exact",

          version:
            "1.0.0+aaa",
        }
      ).entry.version,
      "1.0.0+aaa"
    );

    assert.equal(
      resolver.resolve(
        "alpha",
        {
          kind:
            "range",

          range:
            "=1.0.0",
        }
      ).entry.version,
      "1.0.0+bbb"
    );
  }
);

test(
  "latest resolution selects the greatest active registry version",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
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
                "2.0.0-beta.1"
              ),

              createEntry(
                "alpha",
                "2.0.0"
              ),

              createRevokedEntry(
                "alpha",
                "3.0.0"
              ),
            ],
          }
        )
      );

    assert.equal(
      resolver.resolve(
        "alpha"
      ).entry.version,
      "2.0.0"
    );
  }
);

test(
  "range resolution selects the greatest active satisfying version",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
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
                "1.5.0"
              ),

              createEntry(
                "alpha",
                "2.0.0-beta.1"
              ),

              createEntry(
                "alpha",
                "2.0.0"
              ),
            ],
          }
        )
      );

    assert.equal(
      resolver.resolve(
        "alpha",
        {
          kind:
            "range",

          range:
            ">=1.0.0 <2.0.0",
        }
      ).entry.version,
      "1.5.0"
    );

    assert.equal(
      resolver.resolve(
        "alpha",
        {
          kind:
            "range",

          range:
            ">=2.0.0-beta.1 <2.0.0",
        }
      ).entry.version,
      "2.0.0-beta.1"
    );
  }
);

test(
  "revoked exact versions and revoked-only ranges fail closed",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
        signSnapshot(
          authority,
          {
            packages: [
              createEntry(
                "alpha",
                "1.0.0"
              ),

              createRevokedEntry(
                "alpha",
                "2.0.0",
                "Compromised artifact."
              ),

              createRevokedEntry(
                "alpha",
                "3.0.0"
              ),
            ],
          }
        )
      );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "exact",

            version:
              "2.0.0",
          }
        ),
      /package 'alpha@2\.0\.0' is revoked: Compromised artifact/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "range",

            range:
              ">=2.0.0",
          }
        ),
      /all versions of 'alpha' satisfying '>=2\.0\.0' are revoked/
    );
  }
);

test(
  "latest resolution rejects packages with no active versions",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
        signSnapshot(
          authority,
          {
            packages: [
              createRevokedEntry(
                "alpha",
                "1.0.0"
              ),
            ],
          }
        )
      );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha"
        ),
      /package 'alpha' has no active versions/
    );
  }
);

test(
  "missing packages, versions, and ranges return distinct failures",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
        signSnapshot(
          authority
        )
      );

    assert.throws(
      () =>
        resolver.resolve(
          "missing"
        ),
      /package 'missing' is not present/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "exact",

            version:
              "2.0.0",
          }
        ),
      /package 'alpha@2\.0\.0' is not present/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "range",

            range:
              ">=2.0.0",
          }
        ),
      /no version of 'alpha' satisfies '>=2\.0\.0'/
    );
  }
);

test(
  "resolution inputs reject invalid identifiers, versions, ranges, and selector kinds",
  () => {
    const authority =
      createAuthority();

    const resolver =
      createResolver(
        authority,
        signSnapshot(
          authority
        )
      );

    assert.throws(
      () =>
        resolver.resolve(
          "../alpha"
        ),
      /Invalid package identifier/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "exact",

            version:
              "v1",
          }
        ),
      /invalid exact semantic version 'v1'/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "range",

            range:
              "*",
          }
        ),
      /invalid semantic-version range '\*'/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          {
            kind:
              "other",
          }
        ),
      /unsupported version selector/
    );

    assert.throws(
      () =>
        resolver.resolve(
          "alpha",
          null
        ),
      /unsupported version selector/
    );
  }
);

test(
  "resolution chains only through an authenticated predecessor",
  () => {
    const authority =
      createAuthority();

    const first =
      createResolver(
        authority,
        signSnapshot(
          authority
        )
      );

    const successor =
      createSuccessor(
        authority,
        first.verifiedSnapshot,
        [
          first
            .verifiedSnapshot
            .snapshot
            .packages[0],

          createEntry(
            "beta",
            "1.0.0"
          ),
        ]
      );

    const second =
      createResolver(
        authority,
        successor,
        {
          previous:
            first.verifiedSnapshot,
        }
      );

    assert.equal(
      second.sequence,
      2
    );

    assert.equal(
      second.resolve(
        "beta"
      ).entry.version,
      "1.0.0"
    );

    assert.throws(
      () =>
        createResolver(
          authority,
          successor,
          {
            previous: {
              snapshot:
                first
                  .verifiedSnapshot
                  .snapshot,

              digest:
                first.digest,
            },
          }
        ),
      /supplied predecessor was not produced by the official registry verifier/
    );
  }
);

test(
  "a caller cannot inject a replacement catalog or verifier into resolution",
  () => {
    const authority =
      createAuthority();

    let replacementCalled =
      false;

    const replacement = {
      resolve() {
        replacementCalled =
          true;

        throw new Error(
          "Replacement must not run."
        );
      },

      verify() {
        replacementCalled =
          true;

        throw new Error(
          "Replacement must not run."
        );
      },
    };

    const resolver =
      new OfficialRegistryResolver(
        signSnapshot(
          authority
        ),
        {
          verifierOptions:
            createVerifierOptions(
              authority
            ),

          catalog:
            replacement,

          verifier:
            replacement,
        }
      );

    assert.equal(
      resolver.resolve(
        "alpha"
      ).entry.version,
      "1.0.0"
    );

    assert.equal(
      replacementCalled,
      false
    );
  }
);
