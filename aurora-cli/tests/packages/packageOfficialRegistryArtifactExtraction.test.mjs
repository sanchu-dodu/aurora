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
  OfficialRegistryArtifactAcquirer,
} from "../../dist/packages/registry/officialRegistryArtifactAcquirer.js";

import {
  OfficialRegistryArtifactCache,
} from "../../dist/packages/registry/officialRegistryArtifactCache.js";

import {
  OfficialRegistryArtifactExtractor,
  assertExtractedOfficialRegistryArtifact,
} from "../../dist/packages/registry/officialRegistryArtifactExtractor.js";

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
  createManifestV1,
} from "./manifestTestUtils.mjs";

const TAR_BLOCK_BYTES =
  512;

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
  archive,
  manifestDigest,
  overrides = {}
) {
  const base = {
    packageId,
    version,
    manifestDigest,
    archive: {
      algorithm:
        "sha256",
      digest:
        sha256(archive),
      size:
        archive.byteLength,
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
  packages,
  sequence = 1
) {
  const candidate = {
    registryVersion:
      1,
    kind:
      "aurora-official-package-registry",
    sequence,
    publishedAt:
      "2026-08-24T11:45:00.000Z",
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

function writeTarString(
  header,
  offset,
  length,
  value
) {
  const bytes =
    Buffer.from(
      value,
      "ascii"
    );

  assert.ok(
    bytes.byteLength <= length,
    `Tar field '${value}' is too long for the test builder.`
  );

  bytes.copy(
    header,
    offset
  );
}

function writeTarOctal(
  header,
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

  assert.ok(
    text.length <=
      length - 1
  );

  writeTarString(
    header,
    offset,
    length - 1,
    text
  );
  header[
    offset +
      length - 1
  ] = 0;
}

function createTarHeader({
  path,
  size,
  type = "0",
  linkName = "",
  corruptChecksum = false,
}) {
  const header =
    Buffer.alloc(
      TAR_BLOCK_BYTES
    );

  writeTarString(
    header,
    0,
    100,
    path
  );
  writeTarOctal(
    header,
    100,
    8,
    type === "5"
      ? 0o700
      : 0o600
  );
  writeTarOctal(
    header,
    108,
    8,
    0
  );
  writeTarOctal(
    header,
    116,
    8,
    0
  );
  writeTarOctal(
    header,
    124,
    12,
    size
  );
  writeTarOctal(
    header,
    136,
    12,
    0
  );

  header.fill(
    0x20,
    148,
    156
  );
  header[156] =
    type.charCodeAt(0);

  writeTarString(
    header,
    157,
    100,
    linkName
  );
  writeTarString(
    header,
    257,
    6,
    "ustar"
  );
  writeTarString(
    header,
    263,
    2,
    "00"
  );

  let checksum = 0;

  for (const byte of header) {
    checksum += byte;
  }

  const checksumText =
    checksum.toString(8)
      .padStart(
        6,
        "0"
      );

  writeTarString(
    header,
    148,
    6,
    checksumText
  );
  header[154] = 0;
  header[155] = 0x20;

  if (corruptChecksum) {
    header[0] =
      header[0] ^ 1;
  }

  return header;
}

function createTar(
  entries,
  options = {}
) {
  const blocks = [];

  for (const entry of entries) {
    const content =
      entry.content ??
      Buffer.alloc(0);

    blocks.push(
      createTarHeader({
        path:
          entry.path,
        size:
          content.byteLength,
        type:
          entry.type ??
          "0",
        linkName:
          entry.linkName ??
          "",
        corruptChecksum:
          entry.corruptChecksum ??
          false,
      })
    );

    if (content.byteLength > 0) {
      blocks.push(content);

      const padding =
        (
          TAR_BLOCK_BYTES -
          (
            content.byteLength %
            TAR_BLOCK_BYTES
          )
        ) %
        TAR_BLOCK_BYTES;

      if (padding > 0) {
        blocks.push(
          Buffer.alloc(padding)
        );
      }
    }
  }

  for (
    let index = 0;
    index <
      (
        options.trailerBlocks ??
        2
      );
    index++
  ) {
    blocks.push(
      Buffer.alloc(
        TAR_BLOCK_BYTES
      )
    );
  }

  return Buffer.concat(blocks);
}

function createManifestBytes(
  packageId,
  version,
  files = [],
  overrides = {}
) {
  const declaredFiles =
    files.map(
      file => ({
        path:
          file.path,
        role:
          file.role ??
          "asset",
        digest:
          file.digest ??
          sha256(file.content),
      })
    );

  const manifest =
    createManifestV1({
      id:
        packageId,
      version,
      files:
        declaredFiles,
      artifact: {
        algorithm:
          "sha256",
        digest:
          calculateArtifactDigest(
            declaredFiles
          ),
      },
      ...overrides,
    });

  return Buffer.from(
    `${JSON.stringify(manifest)}\n`,
    "utf8"
  );
}

function createPackageArchive({
  packageId = "alpha",
  version = "1.0.0",
  files = [],
  manifestBytes,
  extraEntries = [],
  tarOptions,
}) {
  const resolvedManifestBytes =
    manifestBytes ??
    createManifestBytes(
      packageId,
      version,
      files
    );

  const tar =
    createTar(
      [
        {
          path:
            "manifest.json",
          content:
            resolvedManifestBytes,
        },
        ...files.map(
          file => ({
            path:
              file.path,
            content:
              file.content,
          })
        ),
        ...extraEntries,
      ],
      tarOptions
    );

  return {
    manifestBytes:
      resolvedManifestBytes,
    tar,
    archive:
      gzipSync(tar),
  };
}

async function createWorkspace(
  context
) {
  const root =
    await fs.mkdtemp(
      join(
        tmpdir(),
        "aurora-registry-extraction-test-"
      )
    );

  const cacheRoot =
    join(root, "cache");
  const quarantineRoot =
    join(root, "quarantine");
  const extractionRoot =
    join(root, "extraction");

  await Promise.all([
    fs.mkdir(cacheRoot),
    fs.mkdir(quarantineRoot),
    fs.mkdir(extractionRoot),
  ]);

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

  return {
    root,
    cacheRoot,
    quarantineRoot,
    extractionRoot,
  };
}

async function acquireAndCache(
  authority,
  snapshot,
  workspace,
  archive,
  packageId = "alpha"
) {
  const acquirer =
    new OfficialRegistryArtifactAcquirer(
      snapshot,
      {
        registryOptions:
          createRegistryOptions(
            authority
          ),
        quarantineRoot:
          workspace.quarantineRoot,
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
                      archive.byteLength
                    ),
                },
              ]
            );

            await input.onBodyChunk(
              archive
            );
          },
        },
      }
    );

  const acquired =
    await acquirer.acquire(
      packageId,
      {
        kind:
          "exact",
        version:
          "1.0.0",
      }
    );

  const cache =
    new OfficialRegistryArtifactCache(
      snapshot,
      workspace.cacheRoot,
      {
        registryOptions:
          createRegistryOptions(
            authority
          ),
      }
    );

  return cache.store(acquired);
}

function createExtractor(
  authority,
  snapshot,
  extractionRoot,
  options = {}
) {
  return new OfficialRegistryArtifactExtractor(
    snapshot,
    extractionRoot,
    {
      registryOptions:
        createRegistryOptions(
          authority
        ),
      ...options,
    }
  );
}

async function createCachedFixture(
  context,
  options = {}
) {
  const authority =
    createAuthority();
  const workspace =
    await createWorkspace(context);
  const packageId =
    options.packageId ??
    "alpha";
  const version =
    options.version ??
    "1.0.0";
  const packageArchive =
    options.packageArchive ??
    createPackageArchive({
      packageId,
      version,
      files:
        options.files ??
        [],
    });
  const archive =
    options.archive ??
    packageArchive.archive;
  const entry =
    createEntry(
      packageId,
      version,
      archive,
      options.manifestDigest ??
        sha256(
          packageArchive
            .manifestBytes
        ),
      options.entryOverrides
    );
  const snapshot =
    signSnapshot(
      authority,
      [entry]
    );
  const cached =
    await acquireAndCache(
      authority,
      snapshot,
      workspace,
      archive,
      packageId
    );

  return {
    authority,
    workspace,
    packageArchive,
    archive,
    entry,
    snapshot,
    cached,
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

test(
  "verified archive extracts privately and authenticates its manifest and file inventory",
  async context => {
    const payload =
      Buffer.from(
        "verified package payload"
      );
    const fixture =
      await createCachedFixture(
        context,
        {
          files: [
            {
              path:
                "assets/payload.txt",
              content:
                payload,
            },
          ],
        }
      );

    const extracted =
      await createExtractor(
        fixture.authority,
        fixture.snapshot,
        fixture.workspace
          .extractionRoot
      ).extract(
        fixture.cached
      );

    assertExtractedOfficialRegistryArtifact(
      extracted
    );
    assert.equal(
      extracted.source,
      "verified-extraction"
    );
    assert.equal(
      extracted.manifest.id,
      "alpha"
    );
    assert.equal(
      extracted.manifest.version,
      "1.0.0"
    );
    assert.deepEqual(
      await fs.readFile(
        join(
          extracted.packagePath,
          "assets",
          "payload.txt"
        )
      ),
      payload
    );
    assert.deepEqual(
      await fs.readFile(
        extracted.manifestPath
      ),
      fixture.packageArchive
        .manifestBytes
    );
    assert.equal(
      extracted.extractedFiles,
      2
    );
    assert.equal(
      Object.isFrozen(extracted),
      true
    );
    assert.equal(
      Object.isFrozen(
        extracted.manifest
      ),
      true
    );
    assert.equal(
      Object.isFrozen(
        extracted.manifest.files
      ),
      true
    );
  }
);

test(
  "forged cached and extracted receipts are rejected",
  async context => {
    const fixture =
      await createCachedFixture(
        context
      );
    const extractor =
      createExtractor(
        fixture.authority,
        fixture.snapshot,
        fixture.workspace
          .extractionRoot
      );

    await assert.rejects(
      () => extractor.extract({
        ...fixture.cached,
      }),
      TypeError
    );

    assert.throws(
      () =>
        assertExtractedOfficialRegistryArtifact({
          source:
            "verified-extraction",
        }),
      TypeError
    );
  }
);

test(
  "cached archive is reverified during extraction",
  async context => {
    const fixture =
      await createCachedFixture(
        context
      );
    const corrupted =
      Buffer.from(
        await fs.readFile(
          fixture.cached.filePath
        )
      );

    corrupted[
      Math.floor(
        corrupted.byteLength / 2
      )
    ] ^= 1;

    await fs.writeFile(
      fixture.cached.filePath,
      corrupted
    );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /digest|archive|invalid|unexpected|incorrect data check/u
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.workspace
          .extractionRoot
      ),
      []
    );
  }
);

test(
  "manifest bytes must match the digest authenticated by the registry",
  async context => {
    const fixture =
      await createCachedFixture(
        context,
        {
          manifestDigest:
            "f".repeat(64),
        }
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /manifest\.json.*digest/u
    );
  }
);

test(
  "authenticated manifest must be unambiguous valid Package Manifest v1 JSON",
  async context => {
    const invalidManifest =
      Buffer.from(
        '{"manifestVersion":1,"manifestVersion":1}\n'
      );
    const packageArchive =
      createPackageArchive({
        manifestBytes:
          invalidManifest,
      });
    const fixture =
      await createCachedFixture(
        context,
        {
          packageArchive,
        }
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /valid unambiguous Package Manifest/u
    );
  }
);

test(
  "manifest package identity must match the signed registry entry",
  async context => {
    for (
      const manifestBytes
      of [
        createManifestBytes(
          "beta",
          "1.0.0"
        ),
        createManifestBytes(
          "alpha",
          "2.0.0"
        ),
      ]
    ) {
      await context.test(
        sha256(manifestBytes),
        async childContext => {
          const packageArchive =
            createPackageArchive({
              manifestBytes,
            });
          const fixture =
            await createCachedFixture(
              childContext,
              {
                packageArchive,
              }
            );

          await assertIntegrityFailure(
            () =>
              createExtractor(
                fixture.authority,
                fixture.snapshot,
                fixture.workspace
                  .extractionRoot
              ).extract(
                fixture.cached
              ),
            /package identity/u
          );
        }
      );
    }
  }
);

test(
  "current registry revocation blocks an already cached archive",
  async context => {
    const fixture =
      await createCachedFixture(
        context
      );
    const revokedEntry = {
      ...fixture.entry,
      lifecycle: {
        status:
          "revoked",
        reason:
          "security withdrawal",
      },
    };
    const revokedSnapshot =
      signSnapshot(
        fixture.authority,
        [revokedEntry]
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          revokedSnapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /no longer authorizes/u
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.workspace
          .extractionRoot
      ),
      []
    );
  }
);

test(
  "path traversal, absolute paths, and backslashes fail before writing outside staging",
  async context => {
    for (
      const maliciousPath
      of [
        "../escape.txt",
        "/absolute.txt",
        "nested\\escape.txt",
      ]
    ) {
      await context.test(
        maliciousPath,
        async childContext => {
          const packageArchive =
            createPackageArchive({
              extraEntries: [
                {
                  path:
                    maliciousPath,
                  content:
                    Buffer.from("escape"),
                },
              ],
            });
          const fixture =
            await createCachedFixture(
              childContext,
              {
                packageArchive,
              }
            );

          await assertIntegrityFailure(
            () =>
              createExtractor(
                fixture.authority,
                fixture.snapshot,
                fixture.workspace
                  .extractionRoot
              ).extract(
                fixture.cached
              ),
            /path|relative|ambiguous/u
          );

          await assert.rejects(
            fs.access(
              join(
                fixture.workspace.root,
                "escape.txt"
              )
            )
          );
          assert.deepEqual(
            await fs.readdir(
              fixture.workspace
                .extractionRoot
            ),
            []
          );
        }
      );
    }
  }
);

test(
  "duplicate and case-colliding archive paths are rejected",
  async context => {
    const packageArchive =
      createPackageArchive({
        extraEntries: [
          {
            path:
              "asset.txt",
            content:
              Buffer.from("first"),
          },
          {
            path:
              "ASSET.txt",
            content:
              Buffer.from("second"),
          },
        ],
      });
    const fixture =
      await createCachedFixture(
        context,
        {
          packageArchive,
        }
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /duplicates|conflicts/u
    );
  }
);

test(
  "links, devices, and tar extensions are rejected",
  async context => {
    for (
      const type
      of [
        "1",
        "2",
        "3",
        "x",
      ]
    ) {
      await context.test(
        type,
        async childContext => {
          const packageArchive =
            createPackageArchive({
              extraEntries: [
                {
                  path:
                    "unsafe-entry",
                  type,
                  linkName:
                    "manifest.json",
                },
              ],
            });
          const fixture =
            await createCachedFixture(
              childContext,
              {
                packageArchive,
              }
            );

          await assertIntegrityFailure(
            () =>
              createExtractor(
                fixture.authority,
                fixture.snapshot,
                fixture.workspace
                  .extractionRoot
              ).extract(
                fixture.cached
              ),
            /link|device|extension|unsupported/u
          );
        }
      );
    }
  }
);

test(
  "corrupt tar checksums fail closed and remove partial staging",
  async context => {
    const manifestBytes =
      createManifestBytes(
        "alpha",
        "1.0.0"
      );
    const archive =
      gzipSync(
        createTar([
          {
            path:
              "manifest.json",
            content:
              manifestBytes,
            corruptChecksum:
              true,
          },
        ])
      );
    const packageArchive = {
      manifestBytes,
      archive,
    };
    const fixture =
      await createCachedFixture(
        context,
        {
          packageArchive,
        }
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /checksum/u
    );

    assert.deepEqual(
      await fs.readdir(
        fixture.workspace
          .extractionRoot
      ),
      []
    );
  }
);

test(
  "truncated tar and invalid gzip streams fail closed",
  async context => {
    const manifestBytes =
      createManifestBytes(
        "alpha",
        "1.0.0"
      );
    const archives = [
      gzipSync(
        createTar(
          [
            {
              path:
                "manifest.json",
              content:
                manifestBytes,
            },
          ],
          {
            trailerBlocks:
              0,
          }
        )
      ),
      Buffer.from(
        "not a gzip archive"
      ),
    ];

    for (const archive of archives) {
      await context.test(
        sha256(archive),
        async childContext => {
          const packageArchive = {
            manifestBytes,
            archive,
          };
          const fixture =
            await createCachedFixture(
              childContext,
              {
                packageArchive,
              }
            );

          await assertIntegrityFailure(
            () =>
              createExtractor(
                fixture.authority,
                fixture.snapshot,
                fixture.workspace
                  .extractionRoot
              ).extract(
                fixture.cached
              ),
            /end marker|header|gzip|invalid|incorrect|unexpected/u
          );
        }
      );
    }
  }
);

test(
  "entry-count and extracted-byte limits apply before release",
  async context => {
    const payload =
      Buffer.from("bounded");
    const fixture =
      await createCachedFixture(
        context,
        {
          files: [
            {
              path:
                "payload.txt",
              content:
                payload,
            },
          ],
        }
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot,
          {
            maxEntries:
              1,
          }
        ).extract(
          fixture.cached
        ),
      /entry-count/u
    );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot,
          {
            maxExtractedBytes:
              1,
          }
        ).extract(
          fixture.cached
        ),
      /extracted-byte/u
    );
  }
);

test(
  "manifest-declared file digests and inventory are verified after extraction",
  async context => {
    const expected =
      Buffer.from("expected");
    const manifestBytes =
      createManifestBytes(
        "alpha",
        "1.0.0",
        [
          {
            path:
              "payload.txt",
            content:
              expected,
          },
        ]
      );

    const cases = [
      [
        {
          path:
            "payload.txt",
          content:
            Buffer.from("tampered"),
        },
      ],
      [
        {
          path:
            "payload.txt",
          content:
            expected,
        },
        {
          path:
            "undeclared.txt",
          content:
            Buffer.from("extra"),
        },
      ],
    ];

    for (const extraEntries of cases) {
      await context.test(
        extraEntries.length === 1
          ? "digest mismatch"
          : "undeclared file",
        async childContext => {
          const packageArchive =
            createPackageArchive({
              manifestBytes,
              extraEntries,
            });
          const fixture =
            await createCachedFixture(
              childContext,
              {
                packageArchive,
              }
            );

          await assertIntegrityFailure(
            () =>
              createExtractor(
                fixture.authority,
                fixture.snapshot,
                fixture.workspace
                  .extractionRoot
              ).extract(
                fixture.cached
              ),
            /artifact verification|Digest mismatch|Declared files/u
          );
        }
      );
    }
  }
);

test(
  "missing root manifest is rejected",
  async context => {
    const manifestBytes =
      createManifestBytes(
        "alpha",
        "1.0.0"
      );
    const archive =
      gzipSync(
        createTar([
          {
            path:
              "nested/manifest.json",
            content:
              manifestBytes,
          },
        ])
      );
    const fixture =
      await createCachedFixture(
        context,
        {
          packageArchive: {
            manifestBytes,
            archive,
          },
        }
      );

    await assertIntegrityFailure(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot
        ).extract(
          fixture.cached
        ),
      /root manifest\.json/u
    );
  }
);

test(
  "extractor limits reject invalid configuration",
  async context => {
    const fixture =
      await createCachedFixture(
        context
      );

    assert.throws(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot,
          {
            maxExtractedBytes:
              0,
          }
        ),
      TypeError
    );

    assert.throws(
      () =>
        createExtractor(
          fixture.authority,
          fixture.snapshot,
          fixture.workspace
            .extractionRoot,
          {
            maxEntries:
              0,
          }
        ),
      TypeError
    );
  }
);
