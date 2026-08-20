import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import {
  existsSync,
  readFileSync,
} from "node:fs";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  pathToFileURL,
} from "node:url";


const DIST_ROOT =
  process.env.AURORA_TEST_DIST
    ? path.resolve(
        process.env.AURORA_TEST_DIST
      )
    : path.resolve(
        "dist"
      );


async function loadDist(
  relativePath
) {
  return import(
    pathToFileURL(
      path.join(
        DIST_ROOT,
        relativePath
      )
    ).href
  );
}


const {
  RepairManager,
} =
  await loadDist(
    "packages/repair/repairManager.js"
  );


const {
  DurableFileTransaction,
} =
  await loadDist(
    "packages/lifecycle/durableFileTransaction.js"
  );


const {
  LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT,
  LIFECYCLE_JOURNAL_RELATIVE_ROOT,
  LifecycleJournalStore,
} =
  await loadDist(
    "packages/lifecycle/lifecycleJournalStore.js"
  );


const {
  InstalledStateVerifier,
} =
  await loadDist(
    "packages/verify/installedStateVerifier.js"
  );


const {
  PackageWorker,
} =
  await loadDist(
    "packages/installation/packageWorker.js"
  );


const {
  InstallerContext,
} =
  await loadDist(
    "packages/installer/installerContext.js"
  );


const {
  PackageRegistry,
} =
  await loadDist(
    "packages/registry/registry.js"
  );


const TARGET_ID =
  "durable-repair-target";

const OTHER_ID =
  "durable-repair-other";

const VERSION =
  "1.0.0";

const INSTALLED_AT =
  "2026-08-20T10:00:00.000Z";

const TARGET_CONTENT =
  "trusted target\n";

const CORRUPTED_TARGET_CONTENT =
  "corrupted target\n";

const OTHER_CONTENT =
  "trusted other\n";

const INTERRUPTED_TRANSACTION_ID =
  "44444444-4444-4444-8444-444444444444";


function sha256(
  value
) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}


function receipt(
  packageId,
  relativePath,
  content,
  artifactCharacter
) {
  return {
    id:
      packageId,

    version:
      VERSION,

    publisherId:
      "aurora-tests",

    artifactSha256:
      artifactCharacter
        .repeat(64),

    installedAt:
      INSTALLED_AT,

    files: [
      {
        path:
          relativePath,

        action:
          "created",

        sha256:
          sha256(content),

        previousSha256:
          null,
      },
    ],

    dependencies: [],
    environment: [],
  };
}


async function writeJson(
  file,
  value
) {
  await fs.mkdir(
    path.dirname(file),
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    file,
    `${JSON.stringify(
      value,
      null,
      2
    )}\n`,
    "utf8"
  );
}


async function createProject(
  prefix,
  {
    healthy =
      false,
  } = {}
) {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        prefix
      )
    );

  const stateFile =
    path.join(
      root,
      ".aurora",
      "package-state.json"
    );

  const cacheFile =
    path.join(
      root,
      ".aurora",
      "cache.json"
    );

  const lockFile =
    path.join(
      root,
      "aurora.lock"
    );

  const targetFile =
    path.join(
      root,
      "src",
      "target.txt"
    );

  const otherFile =
    path.join(
      root,
      "src",
      "other.txt"
    );

  await fs.mkdir(
    path.dirname(
      targetFile
    ),
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    targetFile,
    TARGET_CONTENT,
    "utf8"
  );

  await fs.writeFile(
    otherFile,
    OTHER_CONTENT,
    "utf8"
  );

  const targetReceipt =
    receipt(
      TARGET_ID,
      "src/target.txt",
      TARGET_CONTENT,
      "a"
    );

  const otherReceipt =
    receipt(
      OTHER_ID,
      "src/other.txt",
      OTHER_CONTENT,
      "b"
    );

  await writeJson(
    stateFile,
    {
      schemaVersion: 1,

      packages: {
        [TARGET_ID]:
          targetReceipt,

        [OTHER_ID]:
          otherReceipt,
      },
    }
  );

  await writeJson(
    cacheFile,
    {
      [TARGET_ID]: {
        version:
          VERSION,

        installedAt:
          INSTALLED_AT,

        verified:
          true,
      },

      [OTHER_ID]: {
        version:
          VERSION,

        installedAt:
          INSTALLED_AT,

        verified:
          true,
      },
    }
  );

  await writeJson(
    lockFile,
    {
      packages: {
        [TARGET_ID]:
          VERSION,

        [OTHER_ID]:
          VERSION,
      },
    }
  );

  await writeJson(
    path.join(
      root,
      "package.json"
    ),
    {
      name:
        "durable-repair-test",

      private:
        true,

      dependencies: {},
    }
  );

  if (!healthy) {
    await fs.writeFile(
      targetFile,
      CORRUPTED_TARGET_CONTENT,
      "utf8"
    );
  }

  return {
    root,
    stateFile,
    cacheFile,
    lockFile,
    targetFile,
    otherFile,
    targetReceipt,
    otherReceipt,
  };
}


function lifecycleLockPath(
  projectRoot
) {
  return path.join(
    projectRoot,
    ".aurora",
    "lifecycle-lock"
  );
}


function recoveredTransactionDirectory(
  projectRoot,
  transactionId
) {
  return path.join(
    projectRoot,
    LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT,
    transactionId
  );
}


async function readActiveJournals(
  projectRoot
) {
  const root =
    path.join(
      projectRoot,
      LIFECYCLE_JOURNAL_RELATIVE_ROOT
    );

  let entries;

  try {
    entries =
      await fs.readdir(
        root,
        {
          withFileTypes: true,
        }
      );
  }
  catch (error) {
    if (
      error?.code ===
        "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const store =
    new LifecycleJournalStore(
      projectRoot
    );

  const journals = [];

  for (
    const entry of entries
  ) {
    if (
      !entry.isDirectory() ||
      entry.name ===
        "recovered"
    ) {
      continue;
    }

    journals.push(
      await store.read(
        entry.name
      )
    );
  }

  return journals.sort(
    (left, right) =>
      left.transactionId
        .localeCompare(
          right.transactionId
        )
  );
}


async function readOnlyJournal(
  projectRoot
) {
  const journals =
    await readActiveJournals(
      projectRoot
    );

  assert.equal(
    journals.length,
    1
  );

  return journals[0];
}


async function assertMissing(
  target
) {
  await assert.rejects(
    fs.access(target),
    error =>
      error?.code ===
        "ENOENT"
  );
}


async function cleanup(
  fixture
) {
  await fs.rm(
    fixture.root,
    {
      recursive: true,
      force: true,
    }
  );
}


function repairedReceipt(
  fixture,
  installedAt =
    "2026-08-20T12:00:00.000Z"
) {
  return {
    ...fixture.targetReceipt,

    installedAt,

    files: [
      {
        path:
          "src/target.txt",

        action:
          "modified",

        sha256:
          sha256(
            TARGET_CONTENT
          ),

        previousSha256:
          sha256(
            CORRUPTED_TARGET_CONTENT
          ),
      },
    ],
  };
}


test(
  "RepairManager commits one exact-identity repair through every durable phase",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-repair-success-"
      );

    const actualVerifier =
      new InstalledStateVerifier();

    const writeLockEvents = [];

    const worker = {
      async install(
        packageId,
        context,
        options
      ) {
        assert.equal(
          packageId,
          TARGET_ID
        );

        assert.deepEqual(
          options,
          {
            mode:
              "repair",

            expectedVersion:
              VERSION,

            expectedPublisherId:
              "aurora-tests",

            expectedArtifactSha256:
              "a".repeat(64),
          }
        );

        const mutating =
          await readOnlyJournal(
            fixture.root
          );

        assert.equal(
          mutating.phase,
          "mutating"
        );

        assert.deepEqual(
          mutating.files.map(
            file =>
              file.path
          ),
          [
            ".aurora/cache.json",
            ".aurora/package-state.json",
            "aurora.lock",
          ]
        );

        await fs.access(
          lifecycleLockPath(
            fixture.root
          )
        );

        await context.createFile(
          "src/target.txt",
          TARGET_CONTENT
        );

        return {
          version:
            VERSION,

          checksum:
            "c".repeat(64),

          receipt:
            repairedReceipt(
              fixture
            ),
        };
      },
    };

    const writeLock = {
      async acquire() {
        writeLockEvents.push(
          "acquired"
        );

        assert.equal(
          existsSync(
            lifecycleLockPath(
              fixture.root
            )
          ),
          true
        );
      },

      release() {
        writeLockEvents.push(
          "released"
        );

        assert.equal(
          existsSync(
            lifecycleLockPath(
              fixture.root
            )
          ),
          true
        );
      },
    };

    try {
      await new RepairManager(
        worker,
        actualVerifier,
        writeLock
      ).repair(
        TARGET_ID,
        fixture.root
      );

      assert.deepEqual(
        writeLockEvents,
        [
          "acquired",
          "released",
        ]
      );

      const journal =
        await readOnlyJournal(
          fixture.root
        );

      assert.equal(
        journal.operation,
        "repair"
      );

      assert.equal(
        journal.phase,
        "committed"
      );

      assert.deepEqual(
        journal.packageIds,
        [
          TARGET_ID,
        ]
      );

      assert.deepEqual(
        journal.files.map(
          file =>
            file.path
        ),
        [
          ".aurora/cache.json",
          ".aurora/package-state.json",
          "aurora.lock",
          "src/target.txt",
        ]
      );

      assert.equal(
        await fs.readFile(
          fixture.targetFile,
          "utf8"
        ),
        TARGET_CONTENT
      );

      const state =
        JSON.parse(
          await fs.readFile(
            fixture.stateFile,
            "utf8"
          )
        );

      const target =
        state.packages[
          TARGET_ID
        ];

      assert.equal(
        target.installedAt,
        INSTALLED_AT
      );

      assert.equal(
        target.files[0].action,
        "created"
      );

      assert.equal(
        target.files[0]
          .previousSha256,
        null
      );

      const cache =
        JSON.parse(
          await fs.readFile(
            fixture.cacheFile,
            "utf8"
          )
        );

      assert.equal(
        cache[TARGET_ID]
          .checksum,
        "c".repeat(64)
      );

      assert.equal(
        cache[TARGET_ID]
          .verified,
        true
      );

      await actualVerifier
        .verify(
          TARGET_ID,
          fixture.root
        );

      await actualVerifier
        .verify(
          OTHER_ID,
          fixture.root
        );

      await assertMissing(
        lifecycleLockPath(
          fixture.root
        )
      );
    }
    finally {
      await cleanup(
        fixture
      );
    }
  }
);


test(
  "RepairManager recovers interrupted lifecycle state before a healthy no-op decision",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-repair-recovery-",
        {
          healthy:
            true,
        }
      );

    const sentinel =
      path.join(
        fixture.root,
        "sentinel.txt"
      );

    await fs.writeFile(
      sentinel,
      "before\n",
      "utf8"
    );

    const interrupted =
      await DurableFileTransaction
        .begin({
          operationName:
            "interrupted update",

          operation:
            "update",

          packageIds: [
            TARGET_ID,
          ],

          projectPath:
            fixture.root,

          transactionId:
            INTERRUPTED_TRANSACTION_ID,

          timestamp:
            "2026-08-20T11:00:00.000Z",
        });

    await interrupted
      .recordModifiedFile(
        sentinel
      );

    await interrupted
      .beginMutation();

    await fs.writeFile(
      sentinel,
      "interrupted\n",
      "utf8"
    );

    let workerCalls = 0;

    const worker = {
      async install() {
        workerCalls += 1;

        throw new Error(
          "healthy repair must not execute"
        );
      },
    };

    try {
      await new RepairManager(
        worker,
        new InstalledStateVerifier()
      ).repair(
        TARGET_ID,
        fixture.root
      );

      assert.equal(
        workerCalls,
        0
      );

      assert.equal(
        await fs.readFile(
          sentinel,
          "utf8"
        ),
        "before\n"
      );

      assert.deepEqual(
        await readActiveJournals(
          fixture.root
        ),
        []
      );

      await fs.access(
        recoveredTransactionDirectory(
          fixture.root,
          INTERRUPTED_TRANSACTION_ID
        )
      );

      await assertMissing(
        lifecycleLockPath(
          fixture.root
        )
      );
    }
    finally {
      await cleanup(
        fixture
      );
    }
  }
);


test(
  "handled final repair verification failure rolls back before releasing lifecycle authority",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-repair-rollback-"
      );

    const beforeState =
      await fs.readFile(
        fixture.stateFile
      );

    const beforeCache =
      await fs.readFile(
        fixture.cacheFile
      );

    const beforeLock =
      await fs.readFile(
        fixture.lockFile
      );

    const actualVerifier =
      new InstalledStateVerifier();

    const verifier = {
      async verify(
        packageId,
        projectPath
      ) {
        return actualVerifier
          .verify(
            packageId,
            projectPath
          );
      },

      async verifyReceipt(
        packageId,
        projectPath,
        ownership
      ) {
        if (
          packageId ===
            TARGET_ID
        ) {
          const journal =
            await readOnlyJournal(
              fixture.root
            );

          if (
            journal.phase ===
              "verifying"
          ) {
            throw new Error(
              "forced-final-repair-verification-failure"
            );
          }
        }

        return actualVerifier
          .verifyReceipt(
            packageId,
            projectPath,
            ownership
          );
      },
    };

    const worker = {
      async install(
        _packageId,
        context
      ) {
        await context.createFile(
          "src/target.txt",
          TARGET_CONTENT
        );

        return {
          version:
            VERSION,

          checksum:
            "d".repeat(64),

          receipt:
            repairedReceipt(
              fixture
            ),
        };
      },
    };

    let released =
      false;

    const writeLock = {
      async acquire() {},

      release() {
        released =
          true;

        assert.equal(
          readFileSync(
            fixture.targetFile,
            "utf8"
          ),
          CORRUPTED_TARGET_CONTENT
        );

        assert.deepEqual(
          readFileSync(
            fixture.stateFile
          ),
          beforeState
        );

        assert.deepEqual(
          readFileSync(
            fixture.cacheFile
          ),
          beforeCache
        );

        assert.deepEqual(
          readFileSync(
            fixture.lockFile
          ),
          beforeLock
        );

        assert.equal(
          existsSync(
            lifecycleLockPath(
              fixture.root
            )
          ),
          true
        );
      },
    };

    try {
      await assert.rejects(
        new RepairManager(
          worker,
          verifier,
          writeLock
        ).repair(
          TARGET_ID,
          fixture.root
        ),
        /forced-final-repair-verification-failure/u
      );

      assert.equal(
        released,
        true
      );

      const journal =
        await readOnlyJournal(
          fixture.root
        );

      assert.equal(
        journal.operation,
        "repair"
      );

      assert.equal(
        journal.phase,
        "verifying"
      );

      await assertMissing(
        lifecycleLockPath(
          fixture.root
        )
      );
    }
    finally {
      await cleanup(
        fixture
      );
    }
  }
);


test(
  "repair rolls back package-controlled collateral damage to another installed package",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-repair-collateral-"
      );

    const worker = {
      async install(
        _packageId,
        context
      ) {
        await context.createFile(
          "src/target.txt",
          TARGET_CONTENT
        );

        await context.createFile(
          "src/other.txt",
          "collateral damage\n"
        );

        return {
          version:
            VERSION,

          checksum:
            "e".repeat(64),

          receipt:
            repairedReceipt(
              fixture
            ),
        };
      },
    };

    try {
      await assert.rejects(
        new RepairManager(
          worker,
          new InstalledStateVerifier()
        ).repair(
          TARGET_ID,
          fixture.root
        ),
        /durable-repair-other.*recorded installed digest/iu
      );

      assert.equal(
        await fs.readFile(
          fixture.targetFile,
          "utf8"
        ),
        CORRUPTED_TARGET_CONTENT
      );

      assert.equal(
        await fs.readFile(
          fixture.otherFile,
          "utf8"
        ),
        OTHER_CONTENT
      );

      const journal =
        await readOnlyJournal(
          fixture.root
        );

      assert.equal(
        journal.phase,
        "mutating"
      );

      await assertMissing(
        lifecycleLockPath(
          fixture.root
        )
      );
    }
    finally {
      await cleanup(
        fixture
      );
    }
  }
);


test(
  "PackageWorker repair bypasses the cache shortcut but rejects a different artifact identity before execution",
  async () => {
    const root =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          "aurora-package-worker-repair-identity-"
        )
      );

    await writeJson(
      path.join(
        root,
        "package.json"
      ),
      {
        name:
          "repair-worker-identity-test",

        private:
          true,

        dependencies: {},
      }
    );

    await writeJson(
      path.join(
        root,
        ".aurora",
        "cache.json"
      ),
      {
        auth: {
          version:
            "1.0.0",

          installedAt:
            INSTALLED_AT,

          verified:
            true,
        },
      }
    );

    try {
      const manifest =
        await new PackageRegistry()
          .getPackage(
            "auth"
          );

      await assert.rejects(
        new PackageWorker()
          .install(
            "auth",
            new InstallerContext(
              root
            ),
            {
              mode:
                "repair",

              expectedVersion:
                manifest.version,

              expectedPublisherId:
                manifest.publisher.id,

              expectedArtifactSha256:
                "f".repeat(64),
            }
          ),
        /repair requires.*f{64}/iu
      );

      await assertMissing(
        path.join(
          root,
          "src",
          "auth.ts"
        )
      );
    }
    finally {
      await fs.rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
