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
  OfficialRegistryCatalog,
} from "../../dist/packages/registry/officialRegistryCatalog.js";

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
  authority
) {
  return new PackageTrustStore([
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
  ]);
}

function createVerifierOptions(
  authority
) {
  return {
    trustStore:
      createTrustStore(
        authority
      ),
  };
}

function createEntry(
  packageId =
    "alpha",
  version =
    "1.0.0",
  {
    lifecycle,
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
        `https://registry.aurora.example/packages/${packageId}/archive.tgz`,
    },

    provenance: {
      type:
        "source",

      url:
        "https://github.com/sanchu-dodu/aurora",

      reference:
        `${packageId}@${version}`,
    },

    lifecycle:
      lifecycle ?? {
        status:
          "active",
      },
  };
}

function createRevokedEntry(
  packageId,
  version,
  reason =
    "Registry package version revoked for test."
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
      "2026-08-24T08:00:00.000Z",

    previousSnapshotDigest:
      null,

    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,

    packages: [
      createEntry(),
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

function createCatalog(
  authority,
  snapshot,
  options = {}
) {
  return new OfficialRegistryCatalog(
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
        "2026-08-24T08:01:00.000Z",

      previousSnapshotDigest:
        previous.digest,

      packages,
    }
  );
}

test(
  "catalog verifies raw registry input before exposing metadata",
  () => {
    const authority =
      createAuthority();

    const raw =
      signSnapshot(
        authority
      );

    const catalog =
      createCatalog(
        authority,
        raw
      );

    assert.equal(
      catalog.sequence,
      1
    );

    assert.match(
      catalog.digest,
      /^[a-f0-9]{64}$/
    );

    assert.equal(
      Object.isFrozen(
        catalog
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        catalog.verifiedSnapshot
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        catalog.verifiedSnapshot
          .snapshot
      ),
      true
    );
  }
);

test(
  "tampered registry metadata is rejected before catalog construction",
  () => {
    const authority =
      createAuthority();

    const raw =
      signSnapshot(
        authority
      );

    raw.packages[0]
      .archive
      .digest =
        "9".repeat(64);

    assert.throws(
      () =>
        createCatalog(
          authority,
          raw
        ),
      /Official package registry verification failed/
    );
  }
);

test(
  "revoked versions are hidden by default and available only with explicit inclusion",
  () => {
    const authority =
      createAuthority();

    const raw =
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
              "2.0.0"
            ),

            createRevokedEntry(
              "beta",
              "1.0.0"
            ),

            createEntry(
              "gamma",
              "1.0.0"
            ),
          ],
        }
      );

    const catalog =
      createCatalog(
        authority,
        raw
      );

    assert.deepEqual(
      catalog.listPackageIds(),
      [
        "alpha",
        "gamma",
      ]
    );

    assert.deepEqual(
      catalog.listPackageIds({
        includeRevoked:
          true,
      }),
      [
        "alpha",
        "beta",
        "gamma",
      ]
    );

    assert.equal(
      catalog.hasPackage(
        "beta"
      ),
      false
    );

    assert.equal(
      catalog.hasPackage(
        "beta",
        {
          includeRevoked:
            true,
        }
      ),
      true
    );

    assert.deepEqual(
      catalog
        .listPackageVersions(
          "alpha"
        )
        .map(
          (entry) =>
            entry.version
        ),
      [
        "1.0.0",
      ]
    );

    assert.deepEqual(
      catalog
        .listPackageVersions(
          "alpha",
          {
            includeRevoked:
              true,
          }
        )
        .map(
          (entry) =>
            entry.version
        ),
      [
        "1.0.0",
        "2.0.0",
      ]
    );

    assert.equal(
      catalog.getPackageVersion(
        "alpha",
        "2.0.0"
      ),
      undefined
    );

    assert.equal(
      catalog.getPackageVersion(
        "alpha",
        "2.0.0",
        {
          includeRevoked:
            true,
        }
      )?.lifecycle.status,
      "revoked"
    );
  }
);

test(
  "latest-version selection uses registry SemVer ordering and ignores revocation by default",
  () => {
    const authority =
      createAuthority();

    const raw =
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
      );

    const catalog =
      createCatalog(
        authority,
        raw
      );

    assert.equal(
      catalog
        .getLatestPackageVersion(
          "alpha"
        )
        ?.version,
      "2.0.0"
    );

    assert.equal(
      catalog
        .getLatestPackageVersion(
          "alpha",
          {
            includeRevoked:
              true,
          }
        )
        ?.version,
      "3.0.0"
    );
  }
);

test(
  "equal-precedence build metadata uses the registry raw-version tie-breaker deterministically",
  () => {
    const authority =
      createAuthority();

    const raw =
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
      );

    const catalog =
      createCatalog(
        authority,
        raw
      );

    assert.equal(
      catalog
        .getLatestPackageVersion(
          "alpha"
        )
        ?.version,
      "1.0.0+bbb"
    );

    assert.equal(
      catalog.getPackageVersion(
        "alpha",
        "1.0.0+aaa"
      )?.version,
      "1.0.0+aaa"
    );

    assert.equal(
      catalog.getPackageVersion(
        "alpha",
        "1.0.0+bbb"
      )?.version,
      "1.0.0+bbb"
    );
  }
);

test(
  "unknown canonical packages return empty results without fabricating metadata",
  () => {
    const authority =
      createAuthority();

    const catalog =
      createCatalog(
        authority,
        signSnapshot(
          authority
        )
      );

    assert.equal(
      catalog.hasPackage(
        "missing"
      ),
      false
    );

    assert.deepEqual(
      catalog.listPackageVersions(
        "missing"
      ),
      []
    );

    assert.equal(
      catalog.getPackageVersion(
        "missing",
        "1.0.0"
      ),
      undefined
    );

    assert.equal(
      catalog.getLatestPackageVersion(
        "missing"
      ),
      undefined
    );
  }
);

test(
  "query inputs reject non-canonical package identifiers and invalid semantic versions",
  () => {
    const authority =
      createAuthority();

    const catalog =
      createCatalog(
        authority,
        signSnapshot(
          authority
        )
      );

    assert.throws(
      () =>
        catalog.hasPackage(
          "../alpha"
        ),
      /Invalid package identifier/
    );

    assert.throws(
      () =>
        catalog.listPackageVersions(
          "Alpha"
        ),
      /Invalid package identifier/
    );

    assert.throws(
      () =>
        catalog.getPackageVersion(
          "alpha",
          "v1"
        ),
      /Official package registry catalog query failed: invalid semantic version/
    );
  }
);

test(
  "catalog collection results and verified package entries remain immutable",
  () => {
    const authority =
      createAuthority();

    const catalog =
      createCatalog(
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
                "beta",
                "1.0.0"
              ),
            ],
          }
        )
      );

    const ids =
      catalog.listPackageIds();

    const versions =
      catalog.listPackageVersions(
        "alpha"
      );

    assert.equal(
      Object.isFrozen(
        ids
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        versions
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        versions[0]
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        versions[0].archive
      ),
      true
    );

    assert.throws(
      () =>
        ids.push(
          "gamma"
        ),
      TypeError
    );

    assert.throws(
      () =>
        versions.push(
          versions[0]
        ),
      TypeError
    );

    assert.throws(
      () => {
        versions[0]
          .archive
          .digest =
            "f".repeat(64);
      },
      TypeError
    );
  }
);

test(
  "authentic catalog verifier result can chain a verified append-only successor",
  () => {
    const authority =
      createAuthority();

    const firstCatalog =
      createCatalog(
        authority,
        signSnapshot(
          authority
        )
      );

    const firstEntry =
      firstCatalog
        .verifiedSnapshot
        .snapshot
        .packages[0];

    const successor =
      createSuccessor(
        authority,
        firstCatalog
          .verifiedSnapshot,
        [
          firstEntry,

          createEntry(
            "beta",
            "1.0.0"
          ),
        ]
      );

    const secondCatalog =
      createCatalog(
        authority,
        successor,
        {
          previous:
            firstCatalog
              .verifiedSnapshot,
        }
      );

    assert.equal(
      secondCatalog.sequence,
      2
    );

    assert.deepEqual(
      secondCatalog.listPackageIds(),
      [
        "alpha",
        "beta",
      ]
    );
  }
);

test(
  "fabricated verified predecessor wrappers cannot cross the catalog verifier boundary",
  () => {
    const authority =
      createAuthority();

    const firstCatalog =
      createCatalog(
        authority,
        signSnapshot(
          authority
        )
      );

    const authenticPrevious =
      firstCatalog
        .verifiedSnapshot;

    const successor =
      createSuccessor(
        authority,
        authenticPrevious,
        [
          authenticPrevious
            .snapshot
            .packages[0],

          createEntry(
            "beta",
            "1.0.0"
          ),
        ]
      );

    const fabricatedPrevious = {
      snapshot:
        authenticPrevious.snapshot,

      digest:
        authenticPrevious.digest,
    };

    assert.throws(
      () =>
        createCatalog(
          authority,
          successor,
          {
            previous:
              fabricatedPrevious,
          }
        ),
      /supplied predecessor was not produced by the official registry verifier/
    );
  }
);

test(
  "non-genesis registry input cannot be catalogued without its authenticated predecessor",
  () => {
    const authority =
      createAuthority();

    const firstCatalog =
      createCatalog(
        authority,
        signSnapshot(
          authority
        )
      );

    const previous =
      firstCatalog
        .verifiedSnapshot;

    const successor =
      createSuccessor(
        authority,
        previous,
        [
          previous
            .snapshot
            .packages[0],

          createEntry(
            "beta",
            "1.0.0"
          ),
        ]
      );

    assert.throws(
      () =>
        createCatalog(
          authority,
          successor
        ),
      /non-genesis registry snapshot requires a previously verified snapshot/
    );
  }
);

test(
  "caller-supplied verifier property cannot replace the catalog verification implementation",
  () => {
    const authority =
      createAuthority();

    let fakeVerifierCalled =
      false;

    const fakeVerifier = {
      verify() {
        fakeVerifierCalled =
          true;

        throw new Error(
          "Fake verifier must never be called."
        );
      },
    };

    const raw =
      signSnapshot(
        authority
      );

    const catalog =
      new OfficialRegistryCatalog(
        raw,
        {
          verifierOptions:
            createVerifierOptions(
              authority
            ),

          /*
           * Deliberately supply a legacy/extra runtime property.
           * JavaScript permits it, but the catalog must ignore it.
           */
          verifier:
            fakeVerifier,
        }
      );

    assert.equal(
      fakeVerifierCalled,
      false
    );

    assert.equal(
      catalog.sequence,
      1
    );
  }
);

test(
  "registry signed by a key outside the configured trust policy is rejected",
  () => {
    const trustedAuthority =
      createAuthority();

    const untrustedAuthority =
      createAuthority();

    const raw =
      signSnapshot(
        untrustedAuthority
      );

    assert.throws(
      () =>
        new OfficialRegistryCatalog(
          raw,
          {
            verifierOptions:
              createVerifierOptions(
                trustedAuthority
              ),
          }
        )
    );
  }
);