import assert from "node:assert/strict";

import {
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
  activateOfficialRegistryRelease,
} from "../../dist/packages/registry/officialRegistryReleaseActivationCommand.js";

import {
  OfficialRegistryActivationStore,
  OfficialRegistryReleaseActivator,
} from "../../dist/packages/registry/officialRegistryReleaseActivation.js";

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
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

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

function verifierOptions(
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

function registryEntry(
  version
) {
  return {
    packageId:
      "alpha",
    version,
    manifestDigest:
      version === "1.0.0"
        ? "1".repeat(64)
        : version === "2.0.0"
          ? "2".repeat(64)
          : "3".repeat(64),
    archive: {
      algorithm:
        "sha256",
      digest:
        version === "1.0.0"
          ? "4".repeat(64)
          : version === "2.0.0"
            ? "5".repeat(64)
            : "6".repeat(64),
      size: 1024,
      url:
        `https://registry.aurora.example/artifacts/${version}/package.tar.gz`,
    },
    provenance: {
      type:
        "source",
      url:
        "https://github.com/sanchu-dodu/aurora",
      reference:
        `alpha@${version}`,
    },
    lifecycle: {
      status:
        "active",
    },
  };
}

function signSnapshot(
  authority,
  {
    sequence,
    previousSnapshotDigest,
    packages,
  }
) {
  const ordered = [
    ...packages,
  ].sort(
    compareOfficialRegistryPackageEntries
  );

  const candidate = {
    registryVersion: 1,
    kind:
      "aurora-official-package-registry",
    sequence,
    publishedAt:
      `2026-08-2${5 + sequence}T08:00:00.000Z`,
    previousSnapshotDigest,
    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,
    packages:
      ordered,
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

async function writeRelease(
  workspaceRoot,
  snapshot,
  name = `release-${snapshot.sequence}`
) {
  const releasePath =
    join(
      workspaceRoot,
      name
    );

  await fs.mkdir(
    releasePath,
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    join(
      releasePath,
      "snapshot.json"
    ),
    `${canonicalizeJson(
      snapshot
    )}\n`,
    "utf8"
  );

  return releasePath;
}

async function createFixture(
  context
) {
  const workspaceRoot =
    await fs.mkdtemp(
      join(
        tmpdir(),
        "aurora-registry-activation-"
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

  const authority =
    createAuthority();

  const options =
    verifierOptions(
      authority
    );

  const verifier =
    new OfficialRegistryVerifier(
      options
    );

  const genesis =
    signSnapshot(
      authority,
      {
        sequence: 1,
        previousSnapshotDigest:
          null,
        packages: [
          registryEntry(
            "1.0.0"
          ),
        ],
      }
    );

  const verifiedGenesis =
    verifier.verify(
      genesis
    );

  const second =
    signSnapshot(
      authority,
      {
        sequence: 2,
        previousSnapshotDigest:
          verifiedGenesis.digest,
        packages: [
          registryEntry(
            "1.0.0"
          ),
          registryEntry(
            "2.0.0"
          ),
        ],
      }
    );

  const verifiedSecond =
    verifier.verify(
      second,
      verifiedGenesis
    );

  const third =
    signSnapshot(
      authority,
      {
        sequence: 3,
        previousSnapshotDigest:
          verifiedSecond.digest,
        packages: [
          registryEntry(
            "1.0.0"
          ),
          registryEntry(
            "2.0.0"
          ),
          registryEntry(
            "3.0.0"
          ),
        ],
      }
    );

  const historyPath =
    join(
      workspaceRoot,
      "history.json"
    );

  await fs.writeFile(
    historyPath,
    `${JSON.stringify([
      genesis,
    ])}\n`,
    "utf8"
  );

  return {
    workspaceRoot,
    authority,
    options,
    genesis,
    second,
    third,
    historyPath,
    secondRelease:
      await writeRelease(
        workspaceRoot,
        second
      ),
    thirdRelease:
      await writeRelease(
        workspaceRoot,
        third
      ),
  };
}

function commandDependencies(
  fixture
) {
  return {
    workspaceRoot:
      fixture.workspaceRoot,
    registryVerifierOptions:
      fixture.options,
  };
}

test(
  "activation command previews without writing and then publishes one authenticated generation",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const preview =
      await activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
          dryRun:
            true,
        },
        commandDependencies(
          fixture
        )
      );

    assert.equal(
      preview.written,
      undefined
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );

    const activated =
      await activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      );

    assert.equal(
      activated.written.reused,
      false
    );

    const pointer =
      JSON.parse(
        await fs.readFile(
          activated.written
            .currentFile,
          "utf8"
        )
      );

    assert.deepEqual(
      pointer,
      activated.activation
        .receipt
    );

    assert.deepEqual(
      await fs.readdir(
        activated.written
          .generationPath
      ),
      [
        "activation.json",
        "history.json",
        "snapshot.json",
      ]
    );

    const history =
      JSON.parse(
        await fs.readFile(
          activated.written
            .historyFile,
          "utf8"
        )
      );

    const verifier =
      new OfficialRegistryVerifier(
        fixture.options
      );

    const first =
      verifier.verify(
        history[0]
      );

    assert.equal(
      verifier.verify(
        history[1],
        first
      ).digest,
      activated.activation
        .digest
    );
  }
);

test(
  "exact activation reruns are idempotent and concurrent callers serialize",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const activation =
      new OfficialRegistryReleaseActivator({
        registryVerifierOptions:
          fixture.options,
      }).prepare(
        [
          fixture.genesis,
        ],
        fixture.second,
        Buffer.from(
          `${canonicalizeJson(
            fixture.second
          )}\n`,
          "utf8"
        )
      );

    const store =
      new OfficialRegistryActivationStore({
        workspaceRoot:
          fixture.workspaceRoot,
      });

    const results =
      await Promise.all([
        store.activate(
          activation
        ),
        store.activate(
          activation
        ),
      ]);

    assert.deepEqual(
      results
        .map(
          result =>
            result.reused
        )
        .sort(),
      [
        false,
        true,
      ]
    );
  }
);

test(
  "activation advances only from the exact locally active authenticated history",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    await activateOfficialRegistryRelease(
      fixture.secondRelease,
      {
        registryHistory:
          fixture.historyPath,
      },
      commandDependencies(
        fixture
      )
    );

    await fs.writeFile(
      fixture.historyPath,
      `${JSON.stringify([
        fixture.genesis,
        fixture.second,
      ])}\n`,
      "utf8"
    );

    const third =
      await activateOfficialRegistryRelease(
        fixture.thirdRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      );

    assert.equal(
      third.written
        .receipt.sequence,
      3
    );

    assert.equal(
      JSON.parse(
        await fs.readFile(
          third.written
            .currentFile,
          "utf8"
        )
      ).snapshotDigest,
      third.activation.digest
    );
  }
);

test(
  "activation rejects rollback, forked successors, and skipped history",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    await activateOfficialRegistryRelease(
      fixture.secondRelease,
      {
        registryHistory:
          fixture.historyPath,
      },
      commandDependencies(
        fixture
      )
    );

    const verifier =
      new OfficialRegistryVerifier(
        fixture.options
      );

    const genesis =
      verifier.verify(
        fixture.genesis
      );

    const fork =
      signSnapshot(
        fixture.authority,
        {
          sequence: 2,
          previousSnapshotDigest:
            genesis.digest,
          packages: [
            registryEntry(
              "1.0.0"
            ),
            registryEntry(
              "3.0.0"
            ),
          ],
        }
      );

    const forkRelease =
      await writeRelease(
        fixture.workspaceRoot,
        fork,
        "fork-release"
      );

    await assert.rejects(
      activateOfficialRegistryRelease(
        forkRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_ACTIVATION_FAILED
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.thirdRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_ACTIVATION_FAILED
    );

    const current =
      JSON.parse(
        await fs.readFile(
          join(
            fixture.workspaceRoot,
            ".aurora",
            "official-registry",
            "current.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      current.sequence,
      2
    );
  }
);

test(
  "activation rejects altered, noncanonical, and ambiguous finalized releases before mutation",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const snapshotFile =
      join(
        fixture.secondRelease,
        "snapshot.json"
      );

    await fs.writeFile(
      snapshotFile,
      `${JSON.stringify(
        fixture.second,
        null,
        2
      )}\n`,
      "utf8"
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      /exact canonical signed snapshot/u
    );

    await fs.writeFile(
      snapshotFile,
      `${canonicalizeJson({
        ...fixture.second,
        publishedAt:
          "2026-08-30T08:00:00.000Z",
      })}\n`,
      "utf8"
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_ACTIVATION_FAILED
    );

    await fs.writeFile(
      join(
        fixture.secondRelease,
        "unexpected.txt"
      ),
      "ambiguous distribution\n",
      "utf8"
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      /must contain exactly snapshot.json/u
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora",
          "official-registry"
        )
      )
    );
  }
);

test(
  "tampered current pointers and immutable generations block reuse and advancement",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const activated =
      await activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      );

    await fs.writeFile(
      activated.written
        .snapshotFile,
      "tampered\n",
      "utf8"
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_ACTIVATION_FAILED
    );

    await fs.writeFile(
      activated.written
        .currentFile,
      "{}\n",
      "utf8"
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_ACTIVATION_FAILED
    );
  }
);

test(
  "a missing current pointer cannot turn a non-empty registry store into a rollback bootstrap",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const activated =
      await activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      );

    await fs.rm(
      activated.written
        .currentFile
    );

    await assert.rejects(
      activateOfficialRegistryRelease(
        fixture.secondRelease,
        {
          registryHistory:
            fixture.historyPath,
        },
        commandDependencies(
          fixture
        )
      ),
      /non-empty registry store is missing its authoritative current pointer/u
    );

    assert.deepEqual(
      await fs.readdir(
        activated.written
          .generationPath
      ),
      [
        "activation.json",
        "history.json",
        "snapshot.json",
      ]
    );
  }
);

test(
  "activation store accepts only authentic activator results",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const activation =
      new OfficialRegistryReleaseActivator({
        registryVerifierOptions:
          fixture.options,
      }).prepare(
        [
          fixture.genesis,
        ],
        fixture.second,
        Buffer.from(
          `${canonicalizeJson(
            fixture.second
          )}\n`,
          "utf8"
        )
      );

    await assert.rejects(
      new OfficialRegistryActivationStore({
        workspaceRoot:
          fixture.workspaceRoot,
      }).activate({
        ...activation,
      }),
      /was not produced by the official registry release activator/u
    );
  }
);
