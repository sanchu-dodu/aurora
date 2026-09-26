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
  OfficialRegistryActiveReader,
  assertVerifiedActiveOfficialRegistry,
} from "../../dist/packages/registry/officialRegistryActiveReader.js";

import {
  resolveActiveOfficialRegistryPackage,
} from "../../dist/packages/registry/officialRegistryActiveCommand.js";

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

test(
  "active reader reauthenticates the selected generation and powers latest exact and range resolution",
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

    const active =
      await new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        registryVerifierOptions:
          fixture.options,
      }).read();

    assert.equal(
      active.current.digest,
      activated.activation.digest
    );

    assert.equal(
      active.previous.digest,
      activated.activation
        .predecessorReceipt
        .snapshotDigest
    );

    assert.equal(
      active.history.length,
      2
    );

    assert.equal(
      active.generationPath,
      activated.written
        .generationPath
    );

    const latest =
      await resolveActiveOfficialRegistryPackage(
        "alpha",
        {},
        commandDependencies(
          fixture
        )
      );

    const exact =
      await resolveActiveOfficialRegistryPackage(
        "alpha",
        {
          version:
            "1.0.0",
        },
        commandDependencies(
          fixture
        )
      );

    const ranged =
      await resolveActiveOfficialRegistryPackage(
        "alpha",
        {
          range:
            "^1.0.0",
        },
        commandDependencies(
          fixture
        )
      );

    assert.equal(
      latest.entry.version,
      "2.0.0"
    );

    assert.equal(
      exact.entry.version,
      "1.0.0"
    );

    assert.equal(
      ranged.entry.version,
      "1.0.0"
    );

    assert.equal(
      latest.registryDigest,
      active.current.digest
    );
  }
);

test(
  "active reader rejects missing state without creating registry files",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    await assert.rejects(
      new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        registryVerifierOptions:
          fixture.options,
      }).read(),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_ACTIVE_STATE_INVALID
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "active reader fails closed on every mutable pointer and generation surface",
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

    const files = [
      activated.written
        .currentFile,
      activated.written
        .activationFile,
      activated.written
        .historyFile,
      activated.written
        .snapshotFile,
    ];

    for (const file of files) {
      const original =
        await fs.readFile(
          file
        );

      await fs.writeFile(
        file,
        "{}\n",
        "utf8"
      );

      await assert.rejects(
        new OfficialRegistryActiveReader({
          workspaceRoot:
            fixture.workspaceRoot,
          registryVerifierOptions:
            fixture.options,
        }).read(),
        error =>
          error.code ===
            ErrorCodes
              .REGISTRY_ACTIVE_STATE_INVALID,
        file
      );

      await fs.writeFile(
        file,
        original
      );
    }

    const unexpected =
      join(
        activated.written
          .generationPath,
        "unexpected.json"
      );

    await fs.writeFile(
      unexpected,
      "{}\n",
      "utf8"
    );

    await assert.rejects(
      new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        registryVerifierOptions:
          fixture.options,
      }).read(),
      /selected generation contains missing or unexpected entries/u
    );
  }
);

test(
  "active reader rejects a coherently rewritten receipt with a forged history digest",
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

    const receipt =
      JSON.parse(
        await fs.readFile(
          activated.written
            .currentFile,
          "utf8"
        )
      );

    const forgedBytes =
      `${canonicalizeJson({
        ...receipt,
        historyDigest:
          "f".repeat(64),
      })}\n`;

    await Promise.all([
      fs.writeFile(
        activated.written
          .currentFile,
        forgedBytes,
        "utf8"
      ),
      fs.writeFile(
        activated.written
          .activationFile,
        forgedBytes,
        "utf8"
      ),
    ]);

    await assert.rejects(
      new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        registryVerifierOptions:
          fixture.options,
      }).read(),
      /history.json does not match the activation history digest/u
    );
  }
);

test(
  "active reader rejects an otherwise consistent generation outside the configured trust policy",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const activated = await activateOfficialRegistryRelease(
      fixture.secondRelease,
      {
        registryHistory:
          fixture.historyPath,
      },
      commandDependencies(
        fixture
      )
    );

    const wrongAuthority =
      createAuthority();

    await assert.rejects(
      new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        expectedSnapshotDigest:
          activated.activation.digest,
        registryVerifierOptions:
          verifierOptions(
            wrongAuthority
          ),
      }).read(),
      error =>
        error.code ===
          ErrorCodes
            .REGISTRY_ACTIVE_STATE_INVALID
    );
  }
);

test(
  "active reader ignores tampering in an inactive older generation while authenticating the complete selected history",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const second =
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

    await fs.writeFile(
      second.written
        .snapshotFile,
      "inactive tampering\n",
      "utf8"
    );

    const active =
      await new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        registryVerifierOptions:
          fixture.options,
      }).read();

    assert.equal(
      active.current.digest,
      third.activation.digest
    );

    assert.equal(
      active.history.length,
      3
    );
  }
);

test(
  "active resolution rejects ambiguous selectors before reading local registry state",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    await assert.rejects(
      resolveActiveOfficialRegistryPackage(
        "alpha",
        {
          version:
            "1.0.0",
          range:
            "^1.0.0",
        },
        commandDependencies(
          fixture
        )
      ),
      /either --version or --range, not both/u
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "active reader results cannot be forged by structural copying",
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

    const active =
      await new OfficialRegistryActiveReader({
        workspaceRoot:
          fixture.workspaceRoot,
        registryVerifierOptions:
          fixture.options,
      }).read();

    assert.doesNotThrow(
      () =>
        assertVerifiedActiveOfficialRegistry(
          active
        )
    );

    assert.throws(
      () =>
        assertVerifiedActiveOfficialRegistry({
          ...active,
        }),
      /was not produced by the active registry reader/u
    );
  }
);

test("trusted registry digest pins reject replay of an older valid generation", async context => {
  const fixture = await createFixture(context);
  const dependencies = commandDependencies(fixture);
  const second = await activateOfficialRegistryRelease(
    fixture.secondRelease,
    { registryHistory: fixture.historyPath },
    dependencies
  );
  const secondPointer = await fs.readFile(second.written.currentFile);

  await fs.writeFile(
    fixture.historyPath,
    `${JSON.stringify([fixture.genesis, fixture.second])}\n`
  );
  const third = await activateOfficialRegistryRelease(
    fixture.thirdRelease,
    { registryHistory: fixture.historyPath },
    dependencies
  );
  const registryDigest = third.activation.digest;

  const resolved = await resolveActiveOfficialRegistryPackage(
    "alpha", { registryDigest }, dependencies
  );
  assert.equal(resolved.registryDigest, registryDigest);
  assert.equal(resolved.entry.version, "3.0.0");

  // An attacker can restore an old receipt outside the forward-only activator.
  await fs.writeFile(third.written.currentFile, secondPointer);

  await assert.rejects(
    resolveActiveOfficialRegistryPackage("alpha", { registryDigest }, dependencies),
    /active snapshot does not match the expected registry digest/u
  );

  // With no independent pin, authenticity alone cannot establish freshness.
  const unpinned = await new OfficialRegistryActiveReader(dependencies).read();
  assert.equal(unpinned.current.digest, second.activation.digest);
  assert.deepEqual(await fs.readFile(second.written.currentFile), secondPointer);
});

test("active resolution rejects malformed digest pins before reading missing registry state", async context => {
  const fixture = await createFixture(context);

  for (const registryDigest of ["", "A".repeat(64), "a".repeat(63), "../snapshot", null, 123]) {
    await assert.rejects(
      resolveActiveOfficialRegistryPackage(
        "alpha", { registryDigest }, commandDependencies(fixture)
      ),
      /expected registry digest must be a lowercase SHA-256 digest/u
    );
  }

  await assert.rejects(fs.access(join(fixture.workspaceRoot, ".aurora")));
});

test("active reader rejects noncanonical and oversized pointers without repairing them", async context => {
  const fixture = await createFixture(context);
  const activated = await activateOfficialRegistryRelease(
    fixture.secondRelease,
    { registryHistory: fixture.historyPath },
    commandDependencies(fixture)
  );
  const pointerFile = activated.written.currentFile;
  const receipt = JSON.parse(await fs.readFile(pointerFile, "utf8"));
  const pretty = `${JSON.stringify(receipt, null, 2)}\n`;
  await fs.writeFile(pointerFile, pretty);
  await assert.rejects(
    new OfficialRegistryActiveReader(commandDependencies(fixture)).read(),
    /current.json is not the exact canonical JSON encoding/u
  );
  assert.equal(await fs.readFile(pointerFile, "utf8"), pretty);

  const oversized = `${canonicalizeJson(receipt)}${" ".repeat(4096)}\n`;
  await fs.writeFile(pointerFile, oversized);
  await assert.rejects(
    new OfficialRegistryActiveReader(commandDependencies(fixture)).read(),
    /current.json is not a bounded regular file/u
  );
  assert.equal(await fs.readFile(pointerFile, "utf8"), oversized);
});

test("active reader rejects a registry root redirected through a link or junction", async context => {
  const fixture = await createFixture(context);
  await activateOfficialRegistryRelease(
    fixture.secondRelease,
    { registryHistory: fixture.historyPath },
    commandDependencies(fixture)
  );
  const root = join(fixture.workspaceRoot, ".aurora", "official-registry");
  const relocated = join(fixture.workspaceRoot, "relocated-registry");
  await fs.rename(root, relocated);
  await fs.symlink(relocated, root, process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    new OfficialRegistryActiveReader(commandDependencies(fixture)).read(),
    error => error.code === ErrorCodes.REGISTRY_ACTIVE_STATE_INVALID
  );
  assert.equal((await fs.readdir(relocated)).length, 2);
});

test("active reader rejects a pointer changed after history verification begins", async context => {
  const fixture = await createFixture(context);
  const activated = await activateOfficialRegistryRelease(
    fixture.secondRelease,
    { registryHistory: fixture.historyPath },
    commandDependencies(fixture)
  );
  const originalOpen = fs.open;
  context.mock.method(fs, "open", async (file, ...options) => {
    if (file === activated.written.historyFile) {
      await fs.writeFile(activated.written.currentFile, "{}\n");
    }
    return originalOpen(file, ...options);
  });

  await assert.rejects(
    new OfficialRegistryActiveReader(commandDependencies(fixture)).read(),
    /active pointer changed during verification/u
  );
});
