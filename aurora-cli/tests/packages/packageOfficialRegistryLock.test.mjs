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
  gzipSync,
} from "node:zlib";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  calculateArtifactDigest,
} from "../../dist/packages/integrity/packageArtifactVerifier.js";

import {
  LockManager,
} from "../../dist/packages/lock/lockManager.js";

import {
  parseLockFile,
  parseOfficialRegistryPackageLockEntry,
} from "../../dist/packages/lock/lockSchema.js";

import {
  OfficialRegistryArtifactAcquirer,
} from "../../dist/packages/registry/officialRegistryArtifactAcquirer.js";

import {
  OfficialRegistryArtifactCache,
} from "../../dist/packages/registry/officialRegistryArtifactCache.js";

import {
  OfficialRegistryArtifactExtractor,
} from "../../dist/packages/registry/officialRegistryArtifactExtractor.js";

import {
  OfficialRegistryPackageLocker,
  assertLockedOfficialRegistryPackage,
} from "../../dist/packages/registry/officialRegistryPackageLocker.js";

import {
  OfficialRegistryPackageInstaller,
} from "../../dist/packages/registry/officialRegistryPackageInstaller.js";

import {
  OfficialRegistryOfflinePackageInstaller,
} from "../../dist/packages/registry/officialRegistryOfflinePackageInstaller.js";

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

import {
  InstalledStateVerifier,
} from "../../dist/packages/verify/installedStateVerifier.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

const TAR_BLOCK_BYTES =
  512;

function sha256(value) {
  return createHash(
    "sha256"
  ).update(value).digest("hex");
}

function createOfficialEntry(
  overrides = {}
) {
  const base = {
    lockVersion:
      1,
    source:
      "official-registry",
    packageId:
      "alpha",
    version:
      "1.0.0",
    registry: {
      sequence:
        1,
      digest:
        "1".repeat(64),
    },
    manifest: {
      algorithm:
        "sha256",
      digest:
        "2".repeat(64),
    },
    archive: {
      algorithm:
        "sha256",
      digest:
        "3".repeat(64),
      size:
        1024,
      url:
        "https://registry.aurora.example/packages/alpha/1.0.0.tgz",
    },
    provenance: {
      type:
        "build",
      url:
        "https://github.com/sanchu-dodu/aurora",
      reference:
        "alpha@1.0.0",
    },
    publisher: {
      id:
        "aurora-tests",
      signatureKeyId:
        null,
    },
    packageArtifact: {
      algorithm:
        "sha256",
      digest:
        "4".repeat(64),
    },
  };

  return {
    ...base,
    ...overrides,
  };
}

async function temporaryDirectory(
  context,
  prefix = "aurora-official-lock-test-"
) {
  const root =
    await fs.mkdtemp(
      join(
        tmpdir(),
        prefix
      )
    );

  context.after(
    async () => {
      await fs.rm(
        root,
        {
          recursive:
            true,
          force:
            true,
        }
      );
    }
  );

  return root;
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
    publicKey:
      encodeEd25519PublicKeySpki(
        publicKey
      ),
    privateKey,
    keyId:
      fingerprintEd25519PublicKey(
        publicKey
      ),
  };
}

function registryOptions(
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
      "2026-08-24T12:30:00.000Z",
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

function writeOctal(
  block,
  offset,
  length,
  value
) {
  const text =
    value.toString(8)
      .padStart(
        length - 1,
        "0"
      );

  Buffer.from(
    text,
    "ascii"
  ).copy(
    block,
    offset
  );
  block[
    offset +
      length - 1
  ] = 0;
}

function tarHeader(
  path,
  size
) {
  const block =
    Buffer.alloc(
      TAR_BLOCK_BYTES
    );

  Buffer.from(
    path,
    "ascii"
  ).copy(block, 0);
  writeOctal(
    block,
    100,
    8,
    0o600
  );
  writeOctal(
    block,
    108,
    8,
    0
  );
  writeOctal(
    block,
    116,
    8,
    0
  );
  writeOctal(
    block,
    124,
    12,
    size
  );
  writeOctal(
    block,
    136,
    12,
    0
  );
  block.fill(
    0x20,
    148,
    156
  );
  block[156] =
    "0".charCodeAt(0);
  Buffer.from(
    "ustar",
    "ascii"
  ).copy(block, 257);
  Buffer.from(
    "00",
    "ascii"
  ).copy(block, 263);

  let checksum = 0;

  for (const byte of block) {
    checksum += byte;
  }

  Buffer.from(
    checksum.toString(8)
      .padStart(6, "0"),
    "ascii"
  ).copy(block, 148);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}

function createTar(
  entries
) {
  const parts = [];

  for (const entry of entries) {
    parts.push(
      tarHeader(
        entry.path,
        entry.content.byteLength
      ),
      entry.content
    );

    const padding =
      (
        TAR_BLOCK_BYTES -
        (
          entry.content.byteLength %
          TAR_BLOCK_BYTES
        )
      ) %
      TAR_BLOCK_BYTES;

    if (padding > 0) {
      parts.push(
        Buffer.alloc(padding)
      );
    }
  }

  parts.push(
    Buffer.alloc(
      TAR_BLOCK_BYTES * 2
    )
  );
  return Buffer.concat(parts);
}

function createPackageArchive(
  {
    id = "alpha",
    version = "1.0.0",
    dependencies = [],
  } = {}
) {
  const payload =
    Buffer.from(
      `${id} lock-pinned payload`
    );
  const files = [
    {
      path:
        "payload.txt",
      role:
        "asset",
      digest:
        sha256(payload),
    },
  ];
  const manifest =
    createManifestV1({
      id:
        id,
      version:
        version,
      dependencies,
      files,
      artifact: {
        algorithm:
          "sha256",
        digest:
          calculateArtifactDigest(
            files
          ),
      },
    });
  const manifestBytes =
    Buffer.from(
      `${JSON.stringify(manifest)}\n`
    );
  const archive =
    gzipSync(
      createTar([
        {
          path:
            "manifest.json",
          content:
            manifestBytes,
        },
        {
          path:
            "payload.txt",
          content:
            payload,
        },
      ])
    );

  return {
    payload,
    manifest,
    manifestBytes,
    archive,
  };
}

async function createPipelineFixture(
  context
) {
  const root =
    await temporaryDirectory(
      context,
      "aurora-official-lock-pipeline-"
    );
  const projectRoot =
    join(root, "project");
  const cacheRoot =
    join(root, "cache");
  const quarantineRoot =
    join(root, "quarantine");
  const extractionRoot =
    join(root, "extraction");

  await Promise.all([
    fs.mkdir(projectRoot),
    fs.mkdir(cacheRoot),
    fs.mkdir(quarantineRoot),
    fs.mkdir(extractionRoot),
  ]);

  const authority =
    createAuthority();
  const packageArchive =
    createPackageArchive();
  const entry = {
    packageId:
      "alpha",
    version:
      "1.0.0",
    manifestDigest:
      sha256(
        packageArchive
          .manifestBytes
      ),
    archive: {
      algorithm:
        "sha256",
      digest:
        sha256(
          packageArchive.archive
        ),
      size:
        packageArchive
          .archive.byteLength,
      url:
        "https://registry.aurora.example/packages/alpha/1.0.0.tgz",
    },
    provenance: {
      type:
        "build",
      url:
        "https://github.com/sanchu-dodu/aurora",
      reference:
        "alpha@1.0.0",
    },
    lifecycle: {
      status:
        "active",
    },
  };
  const snapshot =
    signSnapshot(
      authority,
      [entry]
    );
  const options =
    registryOptions(authority);
  const acquirer =
    new OfficialRegistryArtifactAcquirer(
      snapshot,
      {
        registryOptions:
          options,
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
                      packageArchive
                        .archive.byteLength
                    ),
                },
              ]
            );
            await input.onBodyChunk(
              packageArchive.archive
            );
          },
        },
      }
    );
  const acquired =
    await acquirer.acquire(
      "alpha",
      {
        kind:
          "exact",
        version:
          "1.0.0",
      }
    );
  const cached =
    await new OfficialRegistryArtifactCache(
      snapshot,
      cacheRoot,
      {
        registryOptions:
          options,
      }
    ).store(acquired);
  const extracted =
    await new OfficialRegistryArtifactExtractor(
      snapshot,
      extractionRoot,
      {
        registryOptions:
          options,
      }
    ).extract(cached);

  return {
    root,
    projectRoot,
    cacheRoot,
    quarantineRoot,
    extractionRoot,
    authority,
    options,
    packageArchive,
    entry,
    snapshot,
    acquired,
    cached,
    extracted,
  };
}

async function assertIntegrityFailure(
  action,
  pattern
) {
  await assert.rejects(
    action,
    error => {
      assert.equal(
        error.code,
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED
      );
      assert.match(
        error.message,
        pattern
      );
      return true;
    }
  );
}

async function createLockedInstallFixture(
  context
) {
  const fixture =
    await createPipelineFixture(
      context
    );

  await fs.writeFile(
    join(
      fixture.projectRoot,
      "package.json"
    ),
    `${JSON.stringify({
      name:
        "official-install-project",
      version:
        "1.0.0",
      private:
        true,
      dependencies: {},
    })}\n`
  );

  const locked =
    await new OfficialRegistryPackageLocker(
      fixture.snapshot,
      fixture.projectRoot,
      {
        registryOptions:
          fixture.options,
      }
    ).lock(
      fixture.extracted
    );

  return {
    ...fixture,
    locked,
  };
}

function createRegistryEntry(
  packageArchive
) {
  const {
    id,
    version,
  } = packageArchive.manifest;

  return {
    packageId:
      id,
    version,
    manifestDigest:
      sha256(
        packageArchive
          .manifestBytes
      ),
    archive: {
      algorithm:
        "sha256",
      digest:
        sha256(
          packageArchive.archive
        ),
      size:
        packageArchive
          .archive.byteLength,
      url:
        `https://registry.aurora.example/packages/${id}/${version}.tgz`,
    },
    provenance: {
      type:
        "build",
      url:
        "https://github.com/sanchu-dodu/aurora",
      reference:
        `${id}@${version}`,
    },
    lifecycle: {
      status:
        "active",
    },
  };
}

async function cacheArchive(
  snapshot,
  options,
  quarantineRoot,
  cacheRoot,
  packageArchive
) {
  const packageId =
    packageArchive
      .manifest.id;

  const acquired =
    await new OfficialRegistryArtifactAcquirer(
      snapshot,
      {
        registryOptions:
          options,
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
                      packageArchive
                        .archive
                        .byteLength
                    ),
                },
              ]
            );
            await input.onBodyChunk(
              packageArchive.archive
            );
          },
        },
      }
    ).acquire(
      packageId,
      {
        kind:
          "exact",
        version:
          packageArchive
            .manifest.version,
      }
    );

  return new OfficialRegistryArtifactCache(
    snapshot,
    cacheRoot,
    {
      registryOptions:
        options,
    }
  ).store(acquired);
}

async function createOfflineInstallSetFixture(
  context,
  {
    alphaDependencies = [
      {
        id:
          "beta",
        version:
          "^1.0.0",
        optional:
          false,
      },
    ],
    betaDependencies = [],
  } = {}
) {
  const root =
    await temporaryDirectory(
      context,
      "aurora-official-offline-install-"
    );

  const projectRoot =
    join(root, "project");
  const cacheRoot =
    join(root, "cache");
  const quarantineRoot =
    join(root, "quarantine");
  const lockingExtractionRoot =
    join(
      root,
      "locking-extraction"
    );
  const offlineExtractionRoot =
    join(
      root,
      "offline-extraction"
    );

  await Promise.all([
    fs.mkdir(projectRoot),
    fs.mkdir(cacheRoot),
    fs.mkdir(quarantineRoot),
    fs.mkdir(
      lockingExtractionRoot
    ),
    fs.mkdir(
      offlineExtractionRoot
    ),
  ]);

  await fs.writeFile(
    join(
      projectRoot,
      "package.json"
    ),
    `${JSON.stringify({
      name:
        "official-offline-install-project",
      version:
        "1.0.0",
      private:
        true,
      dependencies: {},
    })}\n`
  );

  const authority =
    createAuthority();
  const options =
    registryOptions(authority);
  const archives = {
    alpha:
      createPackageArchive({
        id:
          "alpha",
        dependencies:
          alphaDependencies,
      }),
    beta:
      createPackageArchive({
        id:
          "beta",
        dependencies:
          betaDependencies,
      }),
  };
  const snapshot =
    signSnapshot(
      authority,
      Object.values(archives)
        .map(createRegistryEntry)
    );

  const cached = {};

  for (
    const [
      packageId,
      packageArchive,
    ]
    of Object.entries(archives)
  ) {
    cached[packageId] =
      await cacheArchive(
        snapshot,
        options,
        quarantineRoot,
        cacheRoot,
        packageArchive
      );
  }

  const extractor =
    new OfficialRegistryArtifactExtractor(
      snapshot,
      lockingExtractionRoot,
      {
        registryOptions:
          options,
      }
    );
  const locker =
    new OfficialRegistryPackageLocker(
      snapshot,
      projectRoot,
      {
        registryOptions:
          options,
      }
    );
  const originalExtractions = [];
  const originalLocks = {};

  for (
    const packageId
    of ["beta", "alpha"]
  ) {
    const extracted =
      await extractor.extract(
        cached[packageId]
      );

    originalExtractions.push(
      extracted
    );
    originalLocks[packageId] =
      await locker.lock(
        extracted
      );
  }

  for (
    const extracted
    of originalExtractions
  ) {
    await fs.rm(
      extracted.stagingPath,
      {
        recursive:
          true,
        force:
          true,
      }
    );
  }

  return {
    root,
    projectRoot,
    cacheRoot,
    quarantineRoot,
    offlineExtractionRoot,
    authority,
    options,
    archives,
    snapshot,
    cached,
    originalLocks,
  };
}

test(
  "strict lock schema preserves canonical legacy version entries",
  () => {
    assert.deepEqual(
      parseLockFile({
        packages: {
          alpha:
            "1.0.0",
        },
      }),
      {
        packages: {
          alpha:
            "1.0.0",
        },
      }
    );

    assert.throws(
      () =>
        parseLockFile({
          packages: {
            "../alpha":
              "1.0.0",
          },
        })
    );

    assert.throws(
      () =>
        parseLockFile({
          packages: {
            alpha:
              "latest",
          },
        })
    );
  }
);

test(
  "official lock entry schema binds key and complete immutable identity",
  () => {
    const entry =
      createOfficialEntry();

    assert.deepEqual(
      parseLockFile({
        packages: {
          alpha:
            entry,
        },
      }).packages.alpha,
      entry
    );

    assert.throws(
      () =>
        parseLockFile({
          packages: {
            beta:
              entry,
          },
        })
    );

    assert.throws(
      () =>
        parseOfficialRegistryPackageLockEntry({
          ...entry,
          unknown:
            true,
        })
    );
  }
);

test(
  "LockManager rejects ambiguous and malformed JSON without replacing it",
  async context => {
    const root =
      await temporaryDirectory(context);
    const lockPath =
      join(root, "aurora.lock");
    const ambiguous =
      '{"packages":{},"packages":{}}';

    await fs.writeFile(
      lockPath,
      ambiguous
    );

    const manager =
      new LockManager(root);

    await assert.rejects(
      () => manager.read(),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .INVALID_PACKAGE_LOCK
        );
        return true;
      }
    );

    await assert.rejects(
      () =>
        manager.register(
          "alpha",
          "1.0.0"
        )
    );

    assert.equal(
      await fs.readFile(
        lockPath,
        "utf8"
      ),
      ambiguous
    );
  }
);

test(
  "LockManager atomically normalizes concurrent legacy registrations",
  async context => {
    const root =
      await temporaryDirectory(context);
    const manager =
      new LockManager(root);

    await Promise.all([
      manager.register(
        "beta",
        "2.0.0"
      ),
      manager.register(
        "alpha",
        "1.0.0"
      ),
    ]);

    assert.deepEqual(
      await manager.read(),
      {
        packages: {
          alpha:
            "1.0.0",
          beta:
            "2.0.0",
        },
      }
    );

    assert.deepEqual(
      Object.keys(
        JSON.parse(
          await fs.readFile(
            join(root, "aurora.lock"),
            "utf8"
          )
        ).packages
      ),
      [
        "alpha",
        "beta",
      ]
    );
  }
);

test(
  "verified extracted package persists a complete official registry lock identity",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );
    const locked =
      await new OfficialRegistryPackageLocker(
        fixture.snapshot,
        fixture.projectRoot,
        {
          registryOptions:
            fixture.options,
        }
      ).lock(
        fixture.extracted
      );

    assertLockedOfficialRegistryPackage(
      locked
    );
    assert.equal(
      locked.source,
      "verified-lock"
    );
    assert.equal(
      Object.isFrozen(locked),
      true
    );
    assert.equal(
      Object.isFrozen(
        locked.entry
      ),
      true
    );
    assert.equal(
      locked.entry.packageId,
      "alpha"
    );
    assert.equal(
      locked.entry.registry.digest,
      locked.resolved
        .registryDigest
    );
    assert.equal(
      locked.entry.manifest.digest,
      fixture.entry
        .manifestDigest
    );
    assert.equal(
      locked.entry.archive.digest,
      fixture.entry
        .archive.digest
    );
    assert.equal(
      locked.entry.packageArtifact.digest,
      fixture.packageArchive
        .manifest.artifact.digest
    );

    const persisted =
      (
        await new LockManager(
          fixture.projectRoot
        ).read()
      ).packages.alpha;

    assert.deepEqual(
      persisted,
      locked.entry
    );
  }
);

test(
  "official locking preserves unrelated legacy entries",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );
    const manager =
      new LockManager(
        fixture.projectRoot
      );

    await manager.register(
      "legacy",
      "2.0.0"
    );

    await new OfficialRegistryPackageLocker(
      fixture.snapshot,
      fixture.projectRoot,
      {
        registryOptions:
          fixture.options,
      }
    ).lock(
      fixture.extracted
    );

    const lock =
      await manager.read();

    assert.equal(
      lock.packages.legacy,
      "2.0.0"
    );
    assert.equal(
      typeof lock.packages.alpha,
      "object"
    );
  }
);

test(
  "forged extraction and lock receipts are rejected",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );
    const locker =
      new OfficialRegistryPackageLocker(
        fixture.snapshot,
        fixture.projectRoot,
        {
          registryOptions:
            fixture.options,
        }
      );

    await assert.rejects(
      () =>
        locker.lock({
          ...fixture.extracted,
        }),
      TypeError
    );

    assert.throws(
      () =>
        assertLockedOfficialRegistryPackage({
          source:
            "verified-lock",
        }),
      TypeError
    );
  }
);

test(
  "manifest tampering after extraction blocks lock publication",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );

    await fs.appendFile(
      fixture.extracted
        .manifestPath,
      " "
    );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryPackageLocker(
          fixture.snapshot,
          fixture.projectRoot,
          {
            registryOptions:
              fixture.options,
          }
        ).lock(
          fixture.extracted
        ),
      /manifest\.json.*digest/u
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          "aurora.lock"
        )
      )
    );
  }
);

test(
  "artifact tampering after extraction blocks lock publication",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );

    await fs.writeFile(
      join(
        fixture.extracted
          .packagePath,
        "payload.txt"
      ),
      "tampered"
    );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryPackageLocker(
          fixture.snapshot,
          fixture.projectRoot,
          {
            registryOptions:
              fixture.options,
          }
        ).lock(
          fixture.extracted
        ),
      /artifact verification|Digest mismatch/u
    );
  }
);

test(
  "current registry revocation blocks an already extracted package lock",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );
    const revokedSnapshot =
      signSnapshot(
        fixture.authority,
        [
          {
            ...fixture.entry,
            lifecycle: {
              status:
                "revoked",
              reason:
                "security withdrawal",
            },
          },
        ]
      );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryPackageLocker(
          revokedSnapshot,
          fixture.projectRoot,
          {
            registryOptions:
              fixture.options,
          }
        ).lock(
          fixture.extracted
        ),
      /no longer authorizes/u
    );
  }
);

test(
  "registry identity drift blocks lock publication",
  async context => {
    const fixture =
      await createPipelineFixture(
        context
      );
    const changedSnapshot =
      signSnapshot(
        fixture.authority,
        [
          {
            ...fixture.entry,
            archive: {
              ...fixture.entry.archive,
              url:
                "https://registry.aurora.example/packages/alpha/rebuilt.tgz",
            },
          },
        ]
      );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryPackageLocker(
          changedSnapshot,
          fixture.projectRoot,
          {
            registryOptions:
              fixture.options,
          }
        ).lock(
          fixture.extracted
        ),
      /does not match/u
    );
  }
);

test(
  "invalid official lock registration cannot replace a healthy lock",
  async context => {
    const root =
      await temporaryDirectory(context);
    const manager =
      new LockManager(root);

    await manager.register(
      "legacy",
      "1.0.0"
    );

    const before =
      await fs.readFile(
        join(root, "aurora.lock"),
        "utf8"
      );

    await assert.rejects(
      () =>
        manager.registerOfficial(
          "beta",
          createOfficialEntry()
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .INVALID_PACKAGE_LOCK
        );
        return true;
      }
    );

    assert.equal(
      await fs.readFile(
        join(root, "aurora.lock"),
        "utf8"
      ),
      before
    );
  }
);

test(
  "verified official package installs without downgrading its authenticated lock identity",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );

    const before =
      (
        await new LockManager(
          fixture.projectRoot
        ).read()
      ).packages.alpha;

    await new OfficialRegistryPackageInstaller({
      projectRoot:
        fixture.projectRoot,
      trust: {
        requireSignatures:
          false,
      },
    }).install(
      fixture.locked
    );

    const after =
      (
        await new LockManager(
          fixture.projectRoot
        ).read()
      ).packages.alpha;

    assert.equal(
      typeof after,
      "object"
    );
    assert.deepEqual(
      after,
      before
    );

    await new InstalledStateVerifier()
      .verify(
        "alpha",
        fixture.projectRoot
      );

    const cache =
      JSON.parse(
        await fs.readFile(
          join(
            fixture.projectRoot,
            ".aurora",
            "cache.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      cache.alpha.version,
      "1.0.0"
    );

    const state =
      JSON.parse(
        await fs.readFile(
          join(
            fixture.projectRoot,
            ".aurora",
            "package-state.json"
          ),
          "utf8"
        )
      );

    assert.match(
      state.packages.alpha
        .officialLockSha256,
      /^[a-f0-9]{64}$/u
    );
  }
);

test(
  "verified lock receipts deeply freeze nested official identity",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );

    assert.equal(
      Object.isFrozen(
        fixture.locked.entry
          .archive
      ),
      true
    );
    assert.equal(
      Object.isFrozen(
        fixture.locked.entry
          .publisher
      ),
      true
    );

    assert.throws(
      () => {
        fixture.locked.entry
          .archive.digest =
            "0".repeat(64);
      },
      TypeError
    );
  }
);

test(
  "official registry lock does not bypass default package-signature trust",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );

    await assert.rejects(
      () =>
        new OfficialRegistryPackageInstaller({
          projectRoot:
            fixture.projectRoot,
        }).install(
          fixture.locked
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_SIGNATURE_REQUIRED
        );
        return true;
      }
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "official installer rejects forged lock receipts before project mutation",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );

    await assert.rejects(
      () =>
        new OfficialRegistryPackageInstaller({
          projectRoot:
            fixture.projectRoot,
          trust: {
            requireSignatures:
              false,
          },
        }).install({
          ...fixture.locked,
        }),
      TypeError
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "project-bound official lock receipts cannot be replayed into another project",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );
    const otherProject =
      join(
        fixture.root,
        "other-project"
      );

    await fs.mkdir(
      otherProject
    );
    await fs.writeFile(
      join(
        otherProject,
        "package.json"
      ),
      "{}\n"
    );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryPackageInstaller({
          projectRoot:
            otherProject,
          trust: {
            requireSignatures:
              false,
          },
        }).install(
          fixture.locked
        ),
      /different project/u
    );

    await assert.rejects(
      fs.access(
        join(
          otherProject,
          ".aurora"
        )
      )
    );
  }
);

test(
  "downgraded project lock blocks official installation before mutation",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );

    await new LockManager(
      fixture.projectRoot
    ).register(
      "alpha",
      "1.0.0"
    );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryPackageInstaller({
          projectRoot:
            fixture.projectRoot,
          trust: {
            requireSignatures:
              false,
          },
        }).install(
          fixture.locked
        ),
      /does not match.*aurora\.lock/u
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "post-lock manifest and artifact tampering fail before official installation mutation",
  async context => {
    await context.test(
      "manifest",
      async () => {
        const fixture =
          await createLockedInstallFixture(
            context
          );

        await fs.appendFile(
          fixture.locked.extracted
            .manifestPath,
          " "
        );

        await assertIntegrityFailure(
          () =>
            new OfficialRegistryPackageInstaller({
              projectRoot:
                fixture.projectRoot,
              trust: {
                requireSignatures:
                  false,
              },
            }).install(
              fixture.locked
            ),
          /manifest\.json.*digest/u
        );

        await assert.rejects(
          fs.access(
            join(
              fixture.projectRoot,
              ".aurora"
            )
          )
        );
      }
    );

    await context.test(
      "artifact",
      async () => {
        const fixture =
          await createLockedInstallFixture(
            context
          );

        await fs.writeFile(
          join(
            fixture.locked.extracted
              .packagePath,
            "payload.txt"
          ),
          "tampered"
        );

        await assertIntegrityFailure(
          () =>
            new OfficialRegistryPackageInstaller({
              projectRoot:
                fixture.projectRoot,
              trust: {
                requireSignatures:
                  false,
              },
            }).install(
              fixture.locked
            ),
          /artifact verification|Digest mismatch/u
        );

        await assert.rejects(
          fs.access(
            join(
              fixture.projectRoot,
              ".aurora"
            )
          )
        );
      }
    );
  }
);

test(
  "installed-state verification binds the complete official lock identity",
  async context => {
    const fixture =
      await createLockedInstallFixture(
        context
      );

    await new OfficialRegistryPackageInstaller({
      projectRoot:
        fixture.projectRoot,
      trust: {
        requireSignatures:
          false,
      },
    }).install(
      fixture.locked
    );

    const changed =
      JSON.parse(
        JSON.stringify(
          fixture.locked.entry
        )
      );

    changed.provenance.reference =
      "alpha@rebuilt";

    await new LockManager(
      fixture.projectRoot
    ).registerOfficial(
      "alpha",
      changed
    );

    await assertIntegrityFailure(
      () =>
        new InstalledStateVerifier()
          .verify(
            "alpha",
            fixture.projectRoot
          ),
      /complete official registry lock identity/u
    );

    await new LockManager(
      fixture.projectRoot
    ).register(
      "alpha",
      "1.0.0"
    );

    await assertIntegrityFailure(
      () =>
        new InstalledStateVerifier()
          .verify(
            "alpha",
            fixture.projectRoot
          ),
      /requires a full official registry lock/u
    );
  }
);

test(
  "exact locked dependency sets install reproducibly from the verified offline cache",
  async context => {
    const fixture =
      await createOfflineInstallSetFixture(
        context
      );

    const before =
      await new LockManager(
        fixture.projectRoot
      ).read();

    await new OfficialRegistryOfflinePackageInstaller(
      fixture.snapshot,
      {
        projectRoot:
          fixture.projectRoot,
        cacheRoot:
          fixture.cacheRoot,
        extractionRoot:
          fixture.offlineExtractionRoot,
        registryOptions:
          fixture.options,
        trust: {
          requireSignatures:
            false,
        },
      }
    ).install("alpha");

    const after =
      await new LockManager(
        fixture.projectRoot
      ).read();

    assert.deepEqual(
      after,
      before
    );

    await Promise.all([
      new InstalledStateVerifier()
        .verify(
          "alpha",
          fixture.projectRoot
        ),
      new InstalledStateVerifier()
        .verify(
          "beta",
          fixture.projectRoot
        ),
    ]);

    const installed =
      JSON.parse(
        await fs.readFile(
          join(
            fixture.projectRoot,
            ".aurora",
            "cache.json"
          ),
          "utf8"
        )
      );

    assert.deepEqual(
      Object.keys(installed)
        .sort(),
      ["alpha", "beta"]
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.offlineExtractionRoot
      ),
      []
    );
  }
);

test(
  "offline locked installation rejects a missing dependency archive before project mutation",
  async context => {
    const fixture =
      await createOfflineInstallSetFixture(
        context
      );

    await fs.rm(
      fixture.cached.beta
        .filePath
    );

    await assert.rejects(
      () =>
        new OfficialRegistryOfflinePackageInstaller(
          fixture.snapshot,
          {
            projectRoot:
              fixture.projectRoot,
            cacheRoot:
              fixture.cacheRoot,
            extractionRoot:
              fixture.offlineExtractionRoot,
            registryOptions:
              fixture.options,
            trust: {
              requireSignatures:
                false,
            },
          }
        ).install("alpha"),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_ARTIFACT_CACHE_FAILED
        );
        assert.match(
          error.message,
          /beta@1\.0\.0.*offline cache/u
        );
        return true;
      }
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.offlineExtractionRoot
      ),
      []
    );
  }
);

test(
  "offline install cleans authenticated extraction staging when publisher trust rejects the package",
  async context => {
    const fixture =
      await createOfflineInstallSetFixture(
        context
      );

    await assert.rejects(
      () =>
        new OfficialRegistryOfflinePackageInstaller(
          fixture.snapshot,
          {
            projectRoot:
              fixture.projectRoot,
            cacheRoot:
              fixture.cacheRoot,
            extractionRoot:
              fixture.offlineExtractionRoot,
            registryOptions:
              fixture.options,
          }
        ).install("alpha"),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_SIGNATURE_REQUIRED
        );
        return true;
      }
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.offlineExtractionRoot
      ),
      []
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "offline install rejects dependency cycles before project mutation and cleans every staging root",
  async context => {
    const fixture =
      await createOfflineInstallSetFixture(
        context,
        {
          betaDependencies: [
            {
              id:
                "alpha",
              version:
                "^1.0.0",
              optional:
                false,
            },
          ],
        }
      );

    await assert.rejects(
      () =>
        new OfficialRegistryOfflinePackageInstaller(
          fixture.snapshot,
          {
            projectRoot:
              fixture.projectRoot,
            cacheRoot:
              fixture.cacheRoot,
            extractionRoot:
              fixture.offlineExtractionRoot,
            registryOptions:
              fixture.options,
            trust: {
              requireSignatures:
                false,
            },
          }
        ).install("alpha"),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_INCOMPATIBLE
        );
        assert.match(
          error.message,
          /dependency graph contains a cycle/u
        );
        return true;
      }
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.offlineExtractionRoot
      ),
      []
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "offline install binds cached artifacts to the complete pre-existing lock identity",
  async context => {
    const fixture =
      await createOfflineInstallSetFixture(
        context
      );

    const changed =
      JSON.parse(
        JSON.stringify(
          fixture.originalLocks
            .beta.entry
        )
      );

    changed.provenance.reference =
      "beta@different-build";

    await new LockManager(
      fixture.projectRoot
    ).registerOfficial(
      "beta",
      changed
    );

    await assertIntegrityFailure(
      () =>
        new OfficialRegistryOfflinePackageInstaller(
          fixture.snapshot,
          {
            projectRoot:
              fixture.projectRoot,
            cacheRoot:
              fixture.cacheRoot,
            extractionRoot:
              fixture.offlineExtractionRoot,
            registryOptions:
              fixture.options,
            trust: {
              requireSignatures:
                false,
            },
          }
        ).install("alpha"),
      /does not match.*aurora\.lock identity/u
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "offline install rejects a locked dependency outside the authenticated manifest range",
  async context => {
    const fixture =
      await createOfflineInstallSetFixture(
        context,
        {
          alphaDependencies: [
            {
              id:
                "beta",
              version:
                "^2.0.0",
              optional:
                false,
            },
          ],
        }
      );

    await assert.rejects(
      () =>
        new OfficialRegistryOfflinePackageInstaller(
          fixture.snapshot,
          {
            projectRoot:
              fixture.projectRoot,
            cacheRoot:
              fixture.cacheRoot,
            extractionRoot:
              fixture.offlineExtractionRoot,
            registryOptions:
              fixture.options,
            trust: {
              requireSignatures:
                false,
            },
          }
        ).install("alpha"),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_INCOMPATIBLE
        );
        assert.match(
          error.message,
          /requires 'beta' \^2\.0\.0.*selects 1\.0\.0/u
        );
        return true;
      }
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.projectRoot,
          ".aurora"
        )
      )
    );
  }
);
