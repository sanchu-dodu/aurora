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
  VerifiedPackagePublicationBuilder,
} from "../../dist/packages/publish/packagePublicationBundle.js";

import {
  OfficialRegistryReleaseProposalBuilder,
  OfficialRegistryReleaseProposalWriter,
} from "../../dist/packages/registry/officialRegistryReleaseProposal.js";

import {
  proposeOfficialRegistryRelease,
} from "../../dist/packages/registry/officialRegistryReleaseCommand.js";

import {
  finalizeOfficialRegistryRelease,
} from "../../dist/packages/registry/officialRegistryReleaseFinalizationCommand.js";

import {
  OfficialRegistryReleaseFinalizer,
  OfficialRegistryReleaseWriter,
} from "../../dist/packages/registry/officialRegistryReleaseFinalizer.js";

import {
  compareOfficialRegistryPackageEntries,
} from "../../dist/packages/registry/officialRegistrySchema.js";

import {
  createOfficialRegistrySigningPayload,
} from "../../dist/packages/registry/officialRegistrySigningPayload.js";

import {
  OfficialRegistryVerifier,
} from "../../dist/packages/registry/officialRegistryVerifier.js";

import {
  AURORA_OFFICIAL_PUBLISHER_ID,
} from "../../dist/packages/trust/officialPublisherTrust.js";

import {
  canonicalizeJson,
} from "../../dist/packages/trust/packageCanonicalJson.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

function sha256(value) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}

function createAuthority() {
  const {
    publicKey,
    privateKey,
  } = generateKeyPairSync(
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

function createRegistryVerifier(
  authority
) {
  return new OfficialRegistryVerifier({
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
  });
}

function signRegistrySnapshot(
  authority,
  overrides = {}
) {
  const packages = [
    ...(overrides.packages ??
      []),
  ].sort(
    compareOfficialRegistryPackageEntries
  );

  const candidate = {
    registryVersion: 1,
    kind:
      "aurora-official-package-registry",
    sequence: 1,
    publishedAt:
      "2026-08-26T08:00:00.000Z",
    previousSnapshotDigest:
      null,
    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,
    packages,
    signature: {
      version: 1,
      algorithm:
        "ed25519",
      keyId:
        authority.keyId,
      value:
        "",
    },
    ...overrides,
    packages,
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

function createRegistryEntry(
  packageId,
  version
) {
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
      size: 1024,
      url:
        `https://registry.aurora.example/artifacts/sha256/${"2".repeat(64)}/package.tar.gz`,
    },
    provenance: {
      type:
        "source",
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
}

function packageTrust(
  authority
) {
  return {
    requireSignatures:
      true,
    trustedPublishers: [
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
              "trusted",
          },
        ],
      },
    ],
  };
}

async function signManifest(
  manifestPath,
  authority
) {
  const manifest =
    JSON.parse(
      await fs.readFile(
        manifestPath,
        "utf8"
      )
    );

  const candidate = {
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

  const signed = {
    ...candidate,
    signature: {
      ...candidate.signature,
      value:
        sign(
          null,
          createPackageSigningPayload(
            candidate
          ),
          authority.privateKey
        ).toString(
          "base64url"
        ),
    },
  };

  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      signed,
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function createPublication(
  context,
  {
    packageId =
      "alpha",
    version =
      "2.0.0",
  } = {}
) {
  const workspaceRoot =
    await fs.mkdtemp(
      join(
        tmpdir(),
        "aurora-registry-release-"
      )
    );

  context.after(
    async () => {
      await fs.rm(
        workspaceRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  );

  const packageRoot =
    join(
      workspaceRoot,
      "packages",
      packageId
    );

  await fs.mkdir(
    packageRoot,
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    join(
      packageRoot,
      "payload.txt"
    ),
    "verified registry release payload\n",
    "utf8"
  );

  await writePackageManifestV1(
    packageRoot,
    {
      id:
        packageId,
      version,
    }
  );

  const authority =
    createAuthority();

  await signManifest(
    join(
      packageRoot,
      "manifest.json"
    ),
    authority
  );

  const publication =
    await new VerifiedPackagePublicationBuilder({
      trust:
        packageTrust(
          authority
        ),
    }).build(
      packageRoot
    );

  return {
    workspaceRoot,
    packageRoot,
    publication,
    trust:
      packageTrust(
        authority
      ),
  };
}

function archiveUrl(publication) {
  return `https://registry.aurora.example/artifacts/sha256/${publication.receipt.archive.digest}/package.tar.gz`;
}

function buildProposal(
  predecessor,
  publication,
  registryAuthority,
  overrides = {}
) {
  return new OfficialRegistryReleaseProposalBuilder()
    .build(
      predecessor,
      publication,
      {
        archiveUrl:
          archiveUrl(
            publication
          ),
        publishedAt:
          "2026-08-26T09:00:00.000Z",
        signingKeyId:
          registryAuthority.keyId,
        ...overrides,
      }
    );
}

test(
  "release command verifies the complete signed history and previews before writing an offline proposal",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const genesisSnapshot =
      signRegistrySnapshot(
        registryAuthority,
        {
          packages: [
            createRegistryEntry(
              "alpha",
              "1.0.0"
            ),
          ],
        }
      );

    const verifiedGenesis =
      createRegistryVerifier(
        registryAuthority
      ).verify(
        genesisSnapshot
      );

    const currentSnapshot =
      signRegistrySnapshot(
        registryAuthority,
        {
          sequence: 2,
          publishedAt:
            "2026-08-26T08:30:00.000Z",
          previousSnapshotDigest:
            verifiedGenesis.digest,
          packages: [
            createRegistryEntry(
              "alpha",
              "1.0.0"
            ),
            createRegistryEntry(
              "beta",
              "1.0.0"
            ),
          ],
        }
      );

    const historyPath =
      join(
        fixture.workspaceRoot,
        "registry-history.json"
      );

    await fs.writeFile(
      historyPath,
      `${JSON.stringify([
        genesisSnapshot,
        currentSnapshot,
      ])}\n`,
      "utf8"
    );

    const dependencies = {
      workspaceRoot:
        fixture.workspaceRoot,
      publicationTrust:
        fixture.trust,
      registryVerifierOptions: {
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
                    registryAuthority
                      .publicKey,
                  status:
                    "trusted",
                },
              ],
            },
          ]),
      },
      signingKeyId:
        registryAuthority.keyId,
    };

    const preview =
      await proposeOfficialRegistryRelease(
        "alpha",
        {
          registryHistory:
            "registry-history.json",
          archiveUrl:
            archiveUrl(
              fixture.publication
            ),
          publishedAt:
            "2026-08-26T09:00:00.000Z",
          dryRun:
            true,
        },
        dependencies
      );

    assert.equal(
      preview.written,
      undefined
    );

    assert.equal(
      preview.proposal
        .document
        .unsignedSnapshot
        .sequence,
      3
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );

    const created =
      await proposeOfficialRegistryRelease(
        "alpha",
        {
          registryHistory:
            "registry-history.json",
          archiveUrl:
            archiveUrl(
              fixture.publication
            ),
          publishedAt:
            "2026-08-26T09:00:00.000Z",
        },
        dependencies
      );

    await Promise.all([
      fs.access(
        created.written
          .proposalFile
      ),
      fs.access(
        created.written
          .signingPayloadFile
      ),
    ]);
  }
);

test(
  "release proposal is deterministic and its exact offline payload verifies as the next registry snapshot",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const verifier =
      createRegistryVerifier(
        registryAuthority
      );

    const predecessor =
      verifier.verify(
        signRegistrySnapshot(
          registryAuthority,
          {
            packages: [
              createRegistryEntry(
                "alpha",
                "1.0.0"
              ),
              createRegistryEntry(
                "beta",
                "1.0.0"
              ),
            ],
          }
        )
      );

    const first =
      buildProposal(
        predecessor,
        fixture.publication,
        registryAuthority
      );

    const second =
      buildProposal(
        predecessor,
        fixture.publication,
        registryAuthority
      );

    assert.deepEqual(
      second.document,
      first.document
    );

    assert.deepEqual(
      second.proposalBytes(),
      first.proposalBytes()
    );

    assert.equal(
      first.document
        .unsignedSnapshot
        .sequence,
      2
    );

    assert.equal(
      first.document
        .unsignedSnapshot
        .previousSnapshotDigest,
      predecessor.digest
    );

    assert.deepEqual(
      first.document
        .unsignedSnapshot
        .packages
        .map(
          entry =>
            `${entry.packageId}@${entry.version}`
        ),
      [
        "alpha@1.0.0",
        "alpha@2.0.0",
        "beta@1.0.0",
      ]
    );

    const signingPayload =
      first.signingPayloadBytes();

    assert.deepEqual(
      signingPayload,
      createOfficialRegistrySigningPayload(
        first.document
          .unsignedSnapshot
      )
    );

    assert.equal(
      first.document.signing
        .payload.digest,
      sha256(signingPayload)
    );

    assert.equal(
      first.proposalBytes()
        .toString("utf8"),
      `${canonicalizeJson(
        first.document
      )}\n`
    );

    const signedSnapshot = {
      ...first.document
        .unsignedSnapshot,
      packages: [
        ...first.document
          .unsignedSnapshot
          .packages,
      ],
      signature: {
        ...first.document
          .unsignedSnapshot
          .signature,
        value:
          sign(
            null,
            signingPayload,
            registryAuthority
              .privateKey
          ).toString(
            "base64url"
          ),
      },
    };

    const verifiedSuccessor =
      verifier.verify(
        signedSnapshot,
        predecessor
      );

    assert.equal(
      verifiedSuccessor.snapshot
        .packages[1]
        .archive.url,
      archiveUrl(
        fixture.publication
      )
    );

    assert.doesNotMatch(
      first.proposalBytes()
        .toString("utf8"),
      /PRIVATE KEY/u
    );
  }
);

test(
  "release proposal rejects forged trust-boundary records",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const predecessor =
      createRegistryVerifier(
        registryAuthority
      ).verify(
        signRegistrySnapshot(
          registryAuthority
        )
      );

    assert.throws(
      () =>
        buildProposal(
          {
            snapshot:
              predecessor.snapshot,
            digest:
              predecessor.digest,
          },
          fixture.publication,
          registryAuthority
        ),
      /not produced by the official registry verifier/u
    );

    assert.throws(
      () =>
        buildProposal(
          predecessor,
          {
            ...fixture.publication,
          },
          registryAuthority
        ),
      /authentic verified package publication bundle/u
    );
  }
);

test(
  "release proposal requires an immutable content-addressed HTTPS archive URL",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const predecessor =
      createRegistryVerifier(
        registryAuthority
      ).verify(
        signRegistrySnapshot(
          registryAuthority
        )
      );

    const digest =
      fixture.publication
        .receipt.archive.digest;

    const invalidUrls = [
      `http://registry.aurora.example/artifacts/${digest}/package.tar.gz`,
      `https://registry.aurora.example/artifacts/${digest}/package.tar.gz?download=1`,
      `https://user:secret@registry.aurora.example/artifacts/${digest}/package.tar.gz`,
      `https://registry.aurora.example/artifacts/${"0".repeat(64)}/package.tar.gz`,
      `https://registry.aurora.example/artifacts/${digest}/package.zip`,
    ];

    for (const value of invalidUrls) {
      assert.throws(
        () =>
          buildProposal(
            predecessor,
            fixture.publication,
            registryAuthority,
            {
              archiveUrl:
                value,
            }
          ),
        error =>
          error.code ===
            ErrorCodes
              .REGISTRY_RELEASE_PROPOSAL_FAILED
      );
    }
  }
);

test(
  "release proposal rejects version collisions and non-forward package versions",
  async context => {
    const registryAuthority =
      createAuthority();

    const verifier =
      createRegistryVerifier(
        registryAuthority
      );

    const predecessor =
      verifier.verify(
        signRegistrySnapshot(
          registryAuthority,
          {
            packages: [
              createRegistryEntry(
                "alpha",
                "2.0.0"
              ),
            ],
          }
        )
      );

    const collision =
      await createPublication(
        context,
        {
          version:
            "2.0.0",
        }
      );

    assert.throws(
      () =>
        buildProposal(
          predecessor,
          collision.publication,
          registryAuthority
        ),
      /already exists/u
    );

    const backwards =
      await createPublication(
        context,
        {
          version:
            "1.9.0",
        }
      );

    assert.throws(
      () =>
        buildProposal(
          predecessor,
          backwards.publication,
          registryAuthority
        ),
      /must advance beyond/u
    );
  }
);

test(
  "release proposal rejects backwards timestamps and malformed registry signing-key ids",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const predecessor =
      createRegistryVerifier(
        registryAuthority
      ).verify(
        signRegistrySnapshot(
          registryAuthority
        )
      );

    assert.throws(
      () =>
        buildProposal(
          predecessor,
          fixture.publication,
          registryAuthority,
          {
            publishedAt:
              "2026-08-26T07:59:59.999Z",
          }
        ),
      /cannot move backwards/u
    );

    assert.throws(
      () =>
        buildProposal(
          predecessor,
          fixture.publication,
          registryAuthority,
          {
            signingKeyId:
              "not-a-key-id",
          }
        ),
      /signingKeyId/u
    );
  }
);

test(
  "proposal writer commits one canonical offline-signing package and reuses only exact bytes",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const predecessor =
      createRegistryVerifier(
        registryAuthority
      ).verify(
        signRegistrySnapshot(
          registryAuthority
        )
      );

    const proposal =
      buildProposal(
        predecessor,
        fixture.publication,
        registryAuthority
      );

    const writer =
      new OfficialRegistryReleaseProposalWriter({
        workspaceRoot:
          fixture.workspaceRoot,
      });

    const first =
      await writer.write(
        proposal
      );

    const second =
      await writer.write(
        proposal
      );

    assert.equal(
      second.proposalPath,
      first.proposalPath
    );

    assert.deepEqual(
      await fs.readFile(
        first.proposalFile
      ),
      proposal.proposalBytes()
    );

    assert.deepEqual(
      await fs.readFile(
        first.signingPayloadFile
      ),
      proposal.signingPayloadBytes()
    );

    assert.deepEqual(
      await fs.readdir(
        first.proposalPath
      ),
      [
        "proposal.json",
        "registry-signing-payload.bin",
      ]
    );
  }
);

test(
  "proposal writer rejects forged records and refuses a mismatched content-addressed target",
  async context => {
    const fixture =
      await createPublication(
        context
      );

    const registryAuthority =
      createAuthority();

    const predecessor =
      createRegistryVerifier(
        registryAuthority
      ).verify(
        signRegistrySnapshot(
          registryAuthority
        )
      );

    const proposal =
      buildProposal(
        predecessor,
        fixture.publication,
        registryAuthority
      );

    const writer =
      new OfficialRegistryReleaseProposalWriter({
        workspaceRoot:
          fixture.workspaceRoot,
      });

    await assert.rejects(
      writer.write({
        ...proposal,
      }),
      /authentic verified official registry release proposal/u
    );

    const written =
      await writer.write(
        proposal
      );

    await fs.writeFile(
      written.proposalFile,
      "tampered\n",
      "utf8"
    );

    await assert.rejects(
      writer.write(
        proposal
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_PROPOSAL_FAILED
    );
  }
);

async function createFinalizationFixture(
  context
) {
  const fixture =
    await createPublication(
      context
    );

  const registryAuthority =
    createAuthority();

  const trustStore =
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
              registryAuthority
                .publicKey,
            status:
              "trusted",
          },
        ],
      },
    ]);

  const registryVerifierOptions = {
    trustStore,
  };

  const genesisSnapshot =
    signRegistrySnapshot(
      registryAuthority,
      {
        packages: [
          createRegistryEntry(
            "alpha",
            "1.0.0"
          ),
        ],
      }
    );

  const predecessor =
    new OfficialRegistryVerifier(
      registryVerifierOptions
    ).verify(
      genesisSnapshot
    );

  const proposal =
    buildProposal(
      predecessor,
      fixture.publication,
      registryAuthority
    );

  const writtenProposal =
    await new OfficialRegistryReleaseProposalWriter({
      workspaceRoot:
        fixture.workspaceRoot,
    }).write(
      proposal
    );

  const signatureValue =
    sign(
      null,
      proposal.signingPayloadBytes(),
      registryAuthority.privateKey
    ).toString(
      "base64url"
    );

  const historyPath =
    join(
      fixture.workspaceRoot,
      "registry-history.json"
    );

  const signaturePath =
    join(
      fixture.workspaceRoot,
      "registry-signature.txt"
    );

  await Promise.all([
    fs.writeFile(
      historyPath,
      `${JSON.stringify([
        genesisSnapshot,
      ])}\n`,
      "utf8"
    ),
    fs.writeFile(
      signaturePath,
      `${signatureValue}\n`,
      "utf8"
    ),
  ]);

  return {
    ...fixture,
    registryAuthority,
    registryVerifierOptions,
    genesisSnapshot,
    predecessor,
    proposal,
    writtenProposal,
    signatureValue,
    historyPath,
    signaturePath,
  };
}

test(
  "finalization command reverifies history, previews without writing, and emits one verified immutable snapshot",
  async context => {
    const fixture =
      await createFinalizationFixture(
        context
      );

    const proposalRelative =
      fixture.writtenProposal
        .proposalPath
        .slice(
          fixture.workspaceRoot
            .length + 1
        );

    const dependencies = {
      workspaceRoot:
        fixture.workspaceRoot,
      registryVerifierOptions:
        fixture.registryVerifierOptions,
    };

    const preview =
      await finalizeOfficialRegistryRelease(
        proposalRelative,
        {
          registryHistory:
            "registry-history.json",
          signature:
            "registry-signature.txt",
          dryRun:
            true,
        },
        dependencies
      );

    assert.equal(
      preview.written,
      undefined
    );

    assert.equal(
      preview.release.snapshot.sequence,
      2
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora",
          "registry-releases"
        )
      )
    );

    const finalized =
      await finalizeOfficialRegistryRelease(
        proposalRelative,
        {
          registryHistory:
            "registry-history.json",
          signature:
            "registry-signature.txt",
        },
        dependencies
      );

    const persisted =
      JSON.parse(
        await fs.readFile(
          finalized.written
            .snapshotFile,
          "utf8"
        )
      );

    const independentlyVerified =
      new OfficialRegistryVerifier(
        fixture
          .registryVerifierOptions
      ).verify(
        persisted,
        fixture.predecessor
      );

    assert.equal(
      independentlyVerified.digest,
      finalized.release.digest
    );

    assert.deepEqual(
      persisted,
      finalized.release.snapshot
    );

    assert.deepEqual(
      await fs.readdir(
        finalized.written
          .releasePath
      ),
      [
        "snapshot.json",
      ]
    );
  }
);

test(
  "finalizer accepts only the exact canonical proposal, payload, predecessor, and trusted signature",
  async context => {
    const fixture =
      await createFinalizationFixture(
        context
      );

    const finalizer =
      new OfficialRegistryReleaseFinalizer({
        registryVerifierOptions:
          fixture
            .registryVerifierOptions,
      });

    const first =
      finalizer.finalize(
        fixture.predecessor,
        fixture.proposal.document,
        fixture.proposal.proposalBytes(),
        fixture.proposal
          .signingPayloadBytes(),
        fixture.signatureValue
      );

    const second =
      finalizer.finalize(
        fixture.predecessor,
        fixture.proposal.document,
        fixture.proposal.proposalBytes(),
        fixture.proposal
          .signingPayloadBytes(),
        fixture.signatureValue
      );

    assert.equal(
      first.digest,
      second.digest
    );

    assert.deepEqual(
      first.snapshotBytes(),
      second.snapshotBytes()
    );

    assert.throws(
      () =>
        finalizer.finalize(
          {
            ...fixture.predecessor,
          },
          fixture.proposal.document,
          fixture.proposal.proposalBytes(),
          fixture.proposal
            .signingPayloadBytes(),
          fixture.signatureValue
        ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
    );

    assert.throws(
      () =>
        finalizer.finalize(
          fixture.predecessor,
          fixture.proposal.document,
          fixture.proposal.proposalBytes(),
          Buffer.from(
            "wrong payload",
            "utf8"
          ),
          fixture.signatureValue
        ),
      /signing payload does not exactly match/u
    );

    const wrongAuthority =
      createAuthority();

    const wrongSignature =
      sign(
        null,
        fixture.proposal
          .signingPayloadBytes(),
        wrongAuthority.privateKey
      ).toString(
        "base64url"
      );

    assert.throws(
      () =>
        finalizer.finalize(
          fixture.predecessor,
          fixture.proposal.document,
          fixture.proposal.proposalBytes(),
          fixture.proposal
            .signingPayloadBytes(),
          wrongSignature
        ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
    );
  }
);

test(
  "finalizer rejects stale, extended, noncanonical, and tampered proposal records",
  async context => {
    const fixture =
      await createFinalizationFixture(
        context
      );

    const finalizer =
      new OfficialRegistryReleaseFinalizer({
        registryVerifierOptions:
          fixture
            .registryVerifierOptions,
      });

    const extended = {
      ...fixture.proposal.document,
      unexpected:
        true,
    };

    assert.throws(
      () =>
        finalizer.finalize(
          fixture.predecessor,
          extended,
          Buffer.from(
            `${canonicalizeJson(
              extended
            )}\n`,
            "utf8"
          ),
          fixture.proposal
            .signingPayloadBytes(),
          fixture.signatureValue
        ),
      /missing or unexpected fields/u
    );

    const malformedPublisher =
      structuredClone(
        fixture.proposal.document
      );

    malformedPublisher.publication
      .publisherId =
        "../forged-publisher";

    assert.throws(
      () =>
        finalizer.finalize(
          fixture.predecessor,
          malformedPublisher,
          Buffer.from(
            `${canonicalizeJson(
              malformedPublisher
            )}\n`,
            "utf8"
          ),
          fixture.proposal
            .signingPayloadBytes(),
          fixture.signatureValue
        ),
      /publisherId is not canonical/u
    );

    assert.throws(
      () =>
        finalizer.finalize(
          fixture.predecessor,
          fixture.proposal.document,
          Buffer.from(
            JSON.stringify(
              fixture.proposal
                .document,
              null,
              2
            ),
            "utf8"
          ),
          fixture.proposal
            .signingPayloadBytes(),
          fixture.signatureValue
        ),
      /not the exact canonical proposal/u
    );

    const tampered =
      structuredClone(
        fixture.proposal.document
      );

    tampered.unsignedSnapshot
      .packages.at(-1)
      .archive.digest =
        "f".repeat(64);

    assert.throws(
      () =>
        finalizer.finalize(
          fixture.predecessor,
          tampered,
          Buffer.from(
            `${canonicalizeJson(
              tampered
            )}\n`,
            "utf8"
          ),
          fixture.proposal
            .signingPayloadBytes(),
          fixture.signatureValue
        ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
    );

    const currentSnapshot =
      signRegistrySnapshot(
        fixture.registryAuthority,
        {
          sequence: 2,
          publishedAt:
            "2026-08-26T08:30:00.000Z",
          previousSnapshotDigest:
            fixture.predecessor.digest,
          packages: [
            createRegistryEntry(
              "alpha",
              "1.0.0"
            ),
            createRegistryEntry(
              "beta",
              "1.0.0"
            ),
          ],
        }
      );

    const current =
      new OfficialRegistryVerifier(
        fixture
          .registryVerifierOptions
      ).verify(
        currentSnapshot,
        fixture.predecessor
      );

    assert.throws(
      () =>
        finalizer.finalize(
          current,
          fixture.proposal.document,
          fixture.proposal.proposalBytes(),
          fixture.proposal
            .signingPayloadBytes(),
          fixture.signatureValue
        ),
      /proposal is stale/u
    );
  }
);

test(
  "finalization command rejects noncanonical signature files before writing a release",
  async context => {
    const fixture =
      await createFinalizationFixture(
        context
      );

    await fs.writeFile(
      fixture.signaturePath,
      `${fixture.signatureValue}\r\n`,
      "utf8"
    );

    await assert.rejects(
      finalizeOfficialRegistryRelease(
        fixture.writtenProposal
          .proposalPath,
        {
          registryHistory:
            fixture.historyPath,
          signature:
            fixture.signaturePath,
        },
        {
          workspaceRoot:
            fixture.workspaceRoot,
          registryVerifierOptions:
            fixture
              .registryVerifierOptions,
        }
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora",
          "registry-releases"
        )
      )
    );
  }
);

test(
  "release writer reuses exact output and rejects forged or tampered content-addressed releases",
  async context => {
    const fixture =
      await createFinalizationFixture(
        context
      );

    const release =
      new OfficialRegistryReleaseFinalizer({
        registryVerifierOptions:
          fixture
            .registryVerifierOptions,
      }).finalize(
        fixture.predecessor,
        fixture.proposal.document,
        fixture.proposal.proposalBytes(),
        fixture.proposal
          .signingPayloadBytes(),
        fixture.signatureValue
      );

    const writer =
      new OfficialRegistryReleaseWriter({
        workspaceRoot:
          fixture.workspaceRoot,
      });

    await assert.rejects(
      writer.write({
        ...release,
      }),
      /authentic verified official registry release/u
    );

    const first =
      await writer.write(
        release
      );

    const second =
      await writer.write(
        release
      );

    assert.equal(
      first.snapshotFile,
      second.snapshotFile
    );

    assert.deepEqual(
      await fs.readFile(
        first.snapshotFile
      ),
      release.snapshotBytes()
    );

    await fs.writeFile(
      first.snapshotFile,
      "tampered\n",
      "utf8"
    );

    await assert.rejects(
      writer.write(
        release
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
    );
  }
);
