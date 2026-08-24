import assert from "node:assert/strict";

import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";

import fs from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import test from "node:test";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  OfficialRegistryArtifactAcquirer,
} from "../../dist/packages/registry/officialRegistryArtifactAcquirer.js";

import {
  OfficialRegistryArtifactCache,
  assertCachedOfficialRegistryArtifact,
} from "../../dist/packages/registry/officialRegistryArtifactCache.js";

import {
  createOfficialRegistrySigningPayload,
} from "../../dist/packages/registry/officialRegistrySigningPayload.js";

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

function sha256(value) {
  return createHash(
    "sha256"
  ).update(
    value
  ).digest(
    "hex"
  );
}

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

function createRegistryOptions(
  authority
) {
  return {
    verifierOptions: {
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
    },
  };
}

function createEntry(
  packageId,
  version,
  body,
  overrides = {}
) {
  const base = {
    packageId,
    version,
    manifestDigest:
      "1".repeat(64),

    archive: {
      algorithm:
        "sha256",
      digest:
        sha256(body),
      size:
        body.byteLength,
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

    lifecycle: {
      status:
        "active",
    },
  };

  return {
    ...base,
    ...overrides,
    archive: {
      ...base.archive,
      ...(
        overrides.archive ??
        {}
      ),
    },
    provenance: {
      ...base.provenance,
      ...(
        overrides.provenance ??
        {}
      ),
    },
    lifecycle: {
      ...base.lifecycle,
      ...(
        overrides.lifecycle ??
        {}
      ),
    },
  };
}

function signSnapshot(
  authority,
  packages
) {
  const candidate = {
    registryVersion:
      1,
    kind:
      "aurora-official-package-registry",
    sequence:
      1,
    publishedAt:
      "2026-08-24T11:15:00.000Z",
    previousSnapshotDigest:
      null,
    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,
    packages,
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

  return {
    ...candidate,
    signature: {
      ...candidate.signature,
      value:
        sign(
          null,
          createOfficialRegistrySigningPayload(
            candidate
          ),
          authority.privateKey
        ).toString(
          "base64url"
        ),
    },
  };
}

async function createWorkspace(
  context
) {
  const root =
    await fs.mkdtemp(
      join(
        tmpdir(),
        "aurora-registry-cache-test-"
      )
    );

  const cacheRoot =
    join(
      root,
      "cache"
    );

  const quarantineRoot =
    join(
      root,
      "quarantine"
    );

  await fs.mkdir(
    cacheRoot
  );

  await fs.mkdir(
    quarantineRoot
  );

  context.after(
    async () => {
      await fs.rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  );

  return {
    root,
    cacheRoot,
    quarantineRoot,
  };
}

function createCache(
  authority,
  snapshot,
  cacheRoot,
  options = {}
) {
  return new OfficialRegistryArtifactCache(
    snapshot,
    cacheRoot,
    {
      registryOptions:
        createRegistryOptions(
          authority
        ),
      ...options,
    }
  );
}

async function acquire(
  authority,
  snapshot,
  quarantineRoot,
  packageId,
  body,
  selector = {
    kind:
      "latest",
  }
) {
  const acquirer =
    new OfficialRegistryArtifactAcquirer(
      snapshot,
      {
        registryOptions:
          createRegistryOptions(
            authority
          ),
        quarantineRoot,
        addressResolver: {
          async lookup() {
            return [
              {
                address:
                  "93.184.216.34",
                family:
                  4,
              },
            ];
          },
        },
        transport: {
          async request(input) {
            input.onResponseHead(
              200,
              [
                {
                  name:
                    "Content-Length",
                  value:
                    String(
                      body.byteLength
                    ),
                },
              ]
            );

            await input.onBodyChunk(
              body
            );
          },
        },
      }
    );

  return acquirer.acquire(
    packageId,
    selector
  );
}

function expectedCacheFile(
  cacheRoot,
  body
) {
  const digest =
    sha256(body);

  return join(
    cacheRoot,
    "sha256",
    digest.slice(0, 2),
    `${digest}.archive`
  );
}

function expectedCacheDirectory(
  cacheRoot,
  body
) {
  return join(
    cacheRoot,
    "sha256",
    sha256(body).slice(
      0,
      2
    )
  );
}

async function assertCacheIntegrityFailure(
  operation,
  pattern
) {
  await assert.rejects(
    operation,
    error => {
      assert.equal(
        error.code,
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED
      );

      if (pattern !== undefined) {
        assert.match(
          error.message,
          pattern
        );
      }

      return true;
    }
  );
}

test(
  "verified archive is published content-addressably and can be reused offline",
  async context => {
    const body =
      Buffer.from(
        "offline official archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const artifact =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    const stored =
      await cache.store(
        artifact
      );

    assert.equal(
      stored.source,
      "verified-cache"
    );

    assert.equal(
      stored.filePath,
      expectedCacheFile(
        workspace.cacheRoot,
        body
      )
    );

    assert.deepEqual(
      await fs.readFile(
        stored.filePath
      ),
      body
    );

    assert.equal(
      Object.isFrozen(
        stored
      ),
      true
    );

    assert.doesNotThrow(
      () =>
        assertCachedOfficialRegistryArtifact(
          stored
        )
    );

    assert.throws(
      () =>
        assertCachedOfficialRegistryArtifact({
          ...stored,
        }),
      /authentic cached official registry artifact receipt/u
    );

    await fs.rm(
      workspace.quarantineRoot,
      {
        recursive: true,
        force: true,
      }
    );

    const offline =
      await cache.get(
        "alpha"
      );

    assert.ok(offline);

    assert.equal(
      offline.filePath,
      stored.filePath
    );

    assert.equal(
      offline.resolved.registryDigest,
      stored.resolved.registryDigest
    );

    assert.doesNotThrow(
      () =>
        assertCachedOfficialRegistryArtifact(
          offline
        )
    );

    assert.deepEqual(
      await fs.readdir(
        expectedCacheDirectory(
          workspace.cacheRoot,
          body
        )
      ),
      [
        `${sha256(body)}.archive`,
      ]
    );
  }
);

test(
  "cache miss is read-only and does not fabricate an artifact",
  async context => {
    const body =
      Buffer.from(
        "missing"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    assert.equal(
      await cache.get(
        "alpha"
      ),
      undefined
    );

    assert.deepEqual(
      await fs.readdir(
        workspace.cacheRoot
      ),
      []
    );
  }
);

test(
  "concurrent stores publish one complete cache entry without temporary debris",
  async context => {
    const body =
      Buffer.from(
        "concurrent official archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const artifact =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    const receipts =
      await Promise.all(
        Array.from(
          {
            length:
              8,
          },
          () =>
            cache.store(
              artifact
            )
        )
      );

    assert.equal(
      new Set(
        receipts.map(
          receipt =>
            receipt.filePath
        )
      ).size,
      1
    );

    for (const receipt of receipts) {
      assert.doesNotThrow(
        () =>
          assertCachedOfficialRegistryArtifact(
            receipt
          )
      );
    }

    assert.deepEqual(
      await fs.readdir(
        expectedCacheDirectory(
          workspace.cacheRoot,
          body
        )
      ),
      [
        `${sha256(body)}.archive`,
      ]
    );

    assert.deepEqual(
      await fs.readFile(
        expectedCacheFile(
          workspace.cacheRoot,
          body
        )
      ),
      body
    );
  }
);

test(
  "identical archives deduplicate across distinct authenticated package identities",
  async context => {
    const body =
      Buffer.from(
        "shared archive bytes"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
          createEntry(
            "beta",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const alpha =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const beta =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "beta",
        body
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    const [
      cachedAlpha,
      cachedBeta,
    ] =
      await Promise.all([
        cache.store(
          alpha
        ),
        cache.store(
          beta
        ),
      ]);

    assert.equal(
      cachedAlpha.filePath,
      cachedBeta.filePath
    );

    assert.equal(
      cachedAlpha.resolved.entry.packageId,
      "alpha"
    );

    assert.equal(
      cachedBeta.resolved.entry.packageId,
      "beta"
    );
  }
);

test(
  "cache authenticates registry input internally despite a forged resolver option",
  async context => {
    const body =
      Buffer.from(
        "trusted"
      );

    const authority =
      createAuthority();

    const signed =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const tampered =
      structuredClone(
        signed
      );

    tampered.packages[0]
      .archive.digest =
        "f".repeat(64);

    const workspace =
      await createWorkspace(
        context
      );

    let forgedCalls = 0;

    assert.throws(
      () =>
        new OfficialRegistryArtifactCache(
          tampered,
          workspace.cacheRoot,
          {
            registryOptions:
              createRegistryOptions(
                authority
              ),
            registryResolver: {
              resolve() {
                forgedCalls +=
                  1;
                return {};
              },
            },
          }
        ),
      /registry verification failed/u
    );

    assert.equal(
      forgedCalls,
      0
    );
  }
);

test(
  "forged acquisition receipts cannot publish cache content",
  async context => {
    const body =
      Buffer.from(
        "authentic source"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const artifact =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    await assert.rejects(
      () =>
        cache.store({
          ...artifact,
        }),
      /authentic verified official registry artifact receipt/u
    );

    assert.deepEqual(
      await fs.readdir(
        workspace.cacheRoot
      ),
      []
    );
  }
);

test(
  "receipt from another authentic registry identity is rejected before copying",
  async context => {
    const firstBody =
      Buffer.from(
        "first-body"
      );

    const secondBody =
      Buffer.from(
        "other-body"
      );

    assert.equal(
      firstBody.byteLength,
      secondBody.byteLength
    );

    const authority =
      createAuthority();

    const firstSnapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            firstBody
          ),
        ]
      );

    const secondSnapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            secondBody
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const artifact =
      await acquire(
        authority,
        firstSnapshot,
        workspace.quarantineRoot,
        "alpha",
        firstBody
      );

    const cache =
      createCache(
        authority,
        secondSnapshot,
        workspace.cacheRoot
      );

    await assertCacheIntegrityFailure(
      () =>
        cache.store(
          artifact
        ),
      /does not match the cache's authenticated registry identity/u
    );

    assert.deepEqual(
      await fs.readdir(
        workspace.cacheRoot
      ),
      []
    );
  }
);

test(
  "quarantined source is reverified during cache publication",
  async context => {
    const body =
      Buffer.from(
        "source archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const artifact =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    await fs.writeFile(
      artifact.filePath,
      Buffer.from(
        "source archivf"
      )
    );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    await assertCacheIntegrityFailure(
      () =>
        cache.store(
          artifact
        ),
      /SHA-256 digest does not match/u
    );

    assert.deepEqual(
      await fs.readdir(
        expectedCacheDirectory(
          workspace.cacheRoot,
          body
        )
      ),
      []
    );
  }
);

test(
  "cached content is reverified on every offline lookup",
  async context => {
    const body =
      Buffer.from(
        "cached archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    for (const scenario of [
      {
        name:
          "same-size tampering",
        replacement:
          Buffer.from(
            "cached archivf"
          ),
        pattern:
          /SHA-256 digest does not match/u,
      },
      {
        name:
          "truncation",
        replacement:
          body.subarray(
            0,
            -1
          ),
        pattern:
          /byte count does not match/u,
      },
      {
        name:
          "oversize",
        replacement:
          Buffer.concat([
            body,
            Buffer.from("x"),
          ]),
        pattern:
          /exceeds the signed archive size/u,
      },
    ]) {
      await context.test(
        scenario.name,
        async child => {
          const workspace =
            await createWorkspace(
              child
            );

          const artifact =
            await acquire(
              authority,
              snapshot,
              workspace.quarantineRoot,
              "alpha",
              body
            );

          const cache =
            createCache(
              authority,
              snapshot,
              workspace.cacheRoot
            );

          const stored =
            await cache.store(
              artifact
            );

          await fs.writeFile(
            stored.filePath,
            scenario.replacement
          );

          await assertCacheIntegrityFailure(
            () =>
              cache.get(
                "alpha"
              ),
            scenario.pattern
          );
        }
      );
    }
  }
);

test(
  "unsafe cache path types and linked directories fail closed",
  async context => {
    const body =
      Buffer.from(
        "linked archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    await context.test(
      "cache entry is a directory",
      async child => {
        const workspace =
          await createWorkspace(
            child
          );

        const artifact =
          await acquire(
            authority,
            snapshot,
            workspace.quarantineRoot,
            "alpha",
            body
          );

        const cache =
          createCache(
            authority,
            snapshot,
            workspace.cacheRoot
          );

        const stored =
          await cache.store(
            artifact
          );

        await fs.rm(
          stored.filePath
        );

        await fs.mkdir(
          stored.filePath
        );

        await assertCacheIntegrityFailure(
          () =>
            cache.get(
              "alpha"
            ),
          /unsafe or unreadable|not a regular file/u
        );
      }
    );

    await context.test(
      "digest directory is a link",
      async child => {
        const workspace =
          await createWorkspace(
            child
          );

        const artifact =
          await acquire(
            authority,
            snapshot,
            workspace.quarantineRoot,
            "alpha",
            body
          );

        const cache =
          createCache(
            authority,
            snapshot,
            workspace.cacheRoot
          );

        const stored =
          await cache.store(
            artifact
          );

        const digestDirectory =
          expectedCacheDirectory(
            workspace.cacheRoot,
            body
          );

        await fs.rm(
          digestDirectory,
          {
            recursive: true,
          }
        );

        const outside =
          join(
            workspace.root,
            "outside"
          );

        await fs.mkdir(
          outside
        );

        await fs.writeFile(
          join(
            outside,
            `${sha256(body)}.archive`
          ),
          body
        );

        await fs.symlink(
          outside,
          digestDirectory,
          process.platform ===
            "win32"
            ? "junction"
            : "dir"
        );

        await assertCacheIntegrityFailure(
          () =>
            cache.get(
              "alpha"
            ),
          /cache path is unsafe/u
        );

        assert.equal(
          stored.resolved.entry.packageId,
          "alpha"
        );
      }
    );
  }
);

test(
  "corrupt existing cache entry blocks replacement and leaves no temporary file",
  async context => {
    const body =
      Buffer.from(
        "existing archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const first =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const second =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    const stored =
      await cache.store(
        first
      );

    const corrupt =
      Buffer.from(
        "existing archivf"
      );

    await fs.writeFile(
      stored.filePath,
      corrupt
    );

    await assertCacheIntegrityFailure(
      () =>
        cache.store(
          second
        ),
      /SHA-256 digest does not match/u
    );

    assert.deepEqual(
      await fs.readFile(
        stored.filePath
      ),
      corrupt
    );

    assert.deepEqual(
      await fs.readdir(
        expectedCacheDirectory(
          workspace.cacheRoot,
          body
        )
      ),
      [
        `${sha256(body)}.archive`,
      ]
    );
  }
);

test(
  "registry selection happens before cache lookup and never falls back to another version",
  async context => {
    const oldBody =
      Buffer.from(
        "old archive"
      );

    const latestBody =
      Buffer.from(
        "latest archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            oldBody
          ),
          createEntry(
            "alpha",
            "2.0.0",
            latestBody
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const oldArtifact =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        oldBody,
        {
          kind:
            "exact",
          version:
            "1.0.0",
        }
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    await cache.store(
      oldArtifact
    );

    assert.equal(
      await cache.get(
        "alpha"
      ),
      undefined
    );

    const exactOld =
      await cache.get(
        "alpha",
        {
          kind:
            "range",
          range:
            "^1.0.0",
        }
      );

    assert.ok(exactOld);

    assert.equal(
      exactOld.resolved.entry.version,
      "1.0.0"
    );
  }
);

test(
  "configured cache byte limit fails before directories or files are created",
  async context => {
    const body =
      Buffer.from(
        "limited archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const artifact =
      await acquire(
        authority,
        snapshot,
        workspace.quarantineRoot,
        "alpha",
        body
      );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot,
        {
          maxArchiveBytes:
            body.byteLength -
              1,
        }
      );

    await assert.rejects(
      () =>
        cache.store(
          artifact
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_ARTIFACT_CACHE_FAILED
        );

        assert.match(
          error.message,
          /exceeds the configured cache byte limit/u
        );

        return true;
      }
    );

    assert.deepEqual(
      await fs.readdir(
        workspace.cacheRoot
      ),
      []
    );
  }
);

test(
  "revoked registry selection cannot be satisfied by pre-positioned cache bytes",
  async context => {
    const body =
      Buffer.from(
        "revoked archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body,
            {
              lifecycle: {
                status:
                  "revoked",
                reason:
                  "Withdrawn from offline use.",
              },
            }
          ),
        ]
      );

    const workspace =
      await createWorkspace(
        context
      );

    const file =
      expectedCacheFile(
        workspace.cacheRoot,
        body
      );

    await fs.mkdir(
      expectedCacheDirectory(
        workspace.cacheRoot,
        body
      ),
      {
        recursive: true,
      }
    );

    await fs.writeFile(
      file,
      body
    );

    const cache =
      createCache(
        authority,
        snapshot,
        workspace.cacheRoot
      );

    await assert.rejects(
      () =>
        cache.get(
          "alpha"
        ),
      /no active versions/u
    );

    assert.deepEqual(
      await fs.readFile(
        file
      ),
      body
    );
  }
);
