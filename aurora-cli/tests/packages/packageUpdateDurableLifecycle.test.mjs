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
  PackageUpdateCoordinator,
} =
  await loadDist(
    "packages/update/packageUpdateCoordinator.js"
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


const PACKAGE_ID =
  "durable-update-target";

const OLD_VERSION =
  "1.0.0";

const NEW_VERSION =
  "2.0.0";

const INSTALLED_AT =
  "2026-08-20T10:00:00.000Z";

const INTERRUPTED_TRANSACTION_ID =
  "33333333-3333-4333-8333-333333333333";


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
  version,
  overrides = {}
) {
  return {
    id:
      PACKAGE_ID,

    version,

    publisherId:
      "aurora-tests",

    artifactSha256:
      version === OLD_VERSION
        ? "a".repeat(64)
        : "b".repeat(64),

    installedAt:
      INSTALLED_AT,

    files: [],
    dependencies: [],
    environment: [],

    ...overrides,
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
  prefix
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

  const installedReceipt =
    receipt(
      OLD_VERSION
    );

  await writeJson(
    stateFile,
    {
      schemaVersion: 1,

      packages: {
        [PACKAGE_ID]:
          installedReceipt,
      },
    }
  );

  await writeJson(
    cacheFile,
    {
      [PACKAGE_ID]: {
        version:
          OLD_VERSION,

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
        [PACKAGE_ID]:
          OLD_VERSION,
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
        "durable-update-test",

      private:
        true,

      dependencies: {},
    }
  );

  return {
    root,
    stateFile,
    cacheFile,
    lockFile,
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


function activeTransactionDirectory(
  projectRoot,
  transactionId
) {
  return path.join(
    projectRoot,
    LIFECYCLE_JOURNAL_RELATIVE_ROOT,
    transactionId
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

  const entries =
    await fs.readdir(
      root,
      {
        withFileTypes: true,
      }
    );

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


test(
  "PackageUpdateCoordinator commits one durable update through every phase while holding lifecycle authority",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-update-success-"
      );

    const updatedContent =
      "durably updated\n";

    let receiptChecks =
      0;

    const writeLockEvents = [];

    const verifier = {
      async verify() {
        await fs.access(
          lifecycleLockPath(
            fixture.root
          )
        );
      },

      async verifyReceipt() {
        receiptChecks +=
          1;

        const journal =
          await readOnlyJournal(
            fixture.root
          );

        assert.equal(
          journal.phase,
          receiptChecks === 1
            ? "prepared"
            : "verifying"
        );

        await fs.access(
          lifecycleLockPath(
            fixture.root
          )
        );
      },
    };

    const executor = {
      async execute(
        packageId,
        targetVersion,
        context
      ) {
        const prepared =
          await readOnlyJournal(
            fixture.root
          );

        assert.equal(
          prepared.phase,
          "mutating"
        );

        assert.deepEqual(
          prepared.files.map(
            file =>
              file.path
          ),
          [
            ".aurora/cache.json",
            ".aurora/package-state.json",
            "aurora.lock",
          ]
        );

        await context.createFile(
          "generated/nested/update.txt",
          updatedContent
        );

        const mutated =
          await readOnlyJournal(
            fixture.root
          );

        assert.deepEqual(
          mutated.directories.map(
            directory =>
              directory.path
          ),
          [
            "generated",
            "generated/nested",
          ]
        );

        return {
          version:
            targetVersion,

          checksum:
            "c".repeat(64),

          receipt:
            receipt(
              targetVersion,
              {
                files: [
                  {
                    path:
                      "generated/nested/update.txt",

                    action:
                      "created",

                    sha256:
                      sha256(
                        updatedContent
                      ),

                    previousSha256:
                      null,
                  },
                ],
              }
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
      await new PackageUpdateCoordinator(
        executor,
        verifier,
        writeLock
      ).execute(
        PACKAGE_ID,
        fixture.root,
        OLD_VERSION,
        NEW_VERSION
      );

      assert.equal(
        receiptChecks,
        2
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
        "update"
      );

      assert.equal(
        journal.phase,
        "committed"
      );

      assert.deepEqual(
        journal.packageIds,
        [
          PACKAGE_ID,
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
          "generated/nested/update.txt",
        ]
      );

      assert.equal(
        await fs.readFile(
          path.join(
            fixture.root,
            "generated",
            "nested",
            "update.txt"
          ),
          "utf8"
        ),
        updatedContent
      );

      const state =
        JSON.parse(
          await fs.readFile(
            fixture.stateFile,
            "utf8"
          )
        );

      const cache =
        JSON.parse(
          await fs.readFile(
            fixture.cacheFile,
            "utf8"
          )
        );

      const lock =
        JSON.parse(
          await fs.readFile(
            fixture.lockFile,
            "utf8"
          )
        );

      assert.equal(
        state.packages[
          PACKAGE_ID
        ].version,
        NEW_VERSION
      );

      assert.equal(
        cache[
          PACKAGE_ID
        ].version,
        NEW_VERSION
      );

      assert.equal(
        lock.packages[
          PACKAGE_ID
        ],
        NEW_VERSION
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
  "handled update failure rolls back before lock release and retains incomplete durable evidence",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-update-rollback-"
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

    const output =
      path.join(
        fixture.root,
        "rollback",
        "nested",
        "output.txt"
      );

    let writeLockReleased =
      false;

    const verifier = {
      async verify() {},

      async verifyReceipt() {},
    };

    const executor = {
      async execute(
        _packageId,
        _targetVersion,
        context
      ) {
        await context.createFile(
          "rollback/nested/output.txt",
          "temporary\n"
        );

        throw new Error(
          "forced-durable-update-failure"
        );
      },
    };

    const writeLock = {
      async acquire() {},

      release() {
        writeLockReleased =
          true;

        assert.equal(
          existsSync(output),
          false
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
        new PackageUpdateCoordinator(
          executor,
          verifier,
          writeLock
        ).execute(
          PACKAGE_ID,
          fixture.root,
          OLD_VERSION,
          NEW_VERSION
        ),
        /forced-durable-update-failure/u
      );

      assert.equal(
        writeLockReleased,
        true
      );

      await assertMissing(
        path.join(
          fixture.root,
          "rollback"
        )
      );

      const journal =
        await readOnlyJournal(
          fixture.root
        );

      assert.equal(
        journal.operation,
        "update"
      );

      assert.equal(
        journal.phase,
        "mutating"
      );

      assert.deepEqual(
        journal.directories.map(
          directory =>
            directory.path
        ),
        [
          "rollback",
          "rollback/nested",
        ]
      );

      assert.equal(
        (
          await new LifecycleJournalStore(
            fixture.root
          ).listIncomplete()
        ).length,
        1
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
  "PackageUpdateCoordinator recovers an interrupted transaction before verifying and starting the next update",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-update-recovery-"
      );

    const sentinel =
      path.join(
        fixture.root,
        "sentinel.txt"
      );

    await fs.writeFile(
      sentinel,
      "before interruption\n",
      "utf8"
    );

    const interrupted =
      await DurableFileTransaction
        .begin({
          operationName:
            "interrupted package update",

          operation:
            "update",

          packageIds: [
            PACKAGE_ID,
          ],

          projectPath:
            fixture.root,

          transactionId:
            INTERRUPTED_TRANSACTION_ID,

          timestamp:
            "2026-08-20T09:00:00.000Z",
        });

    await interrupted
      .recordModifiedFile(
        sentinel
      );

    await interrupted
      .beginMutation();

    await fs.writeFile(
      sentinel,
      "interrupted mutation\n",
      "utf8"
    );

    let verifiedAfterRecovery =
      false;

    const verifier = {
      async verify() {
        assert.equal(
          await fs.readFile(
            sentinel,
            "utf8"
          ),
          "before interruption\n"
        );

        await fs.access(
          recoveredTransactionDirectory(
            fixture.root,
            INTERRUPTED_TRANSACTION_ID
          )
        );

        await assertMissing(
          activeTransactionDirectory(
            fixture.root,
            INTERRUPTED_TRANSACTION_ID
          )
        );

        await fs.access(
          lifecycleLockPath(
            fixture.root
          )
        );

        verifiedAfterRecovery =
          true;
      },

      async verifyReceipt() {},
    };

    const executor = {
      async execute(
        _packageId,
        targetVersion
      ) {
        assert.equal(
          verifiedAfterRecovery,
          true
        );

        return {
          version:
            targetVersion,

          checksum:
            "d".repeat(64),

          receipt:
            receipt(
              targetVersion
            ),
        };
      },
    };

    try {
      await new PackageUpdateCoordinator(
        executor,
        verifier,
        {
          async acquire() {},

          release() {},
        }
      ).execute(
        PACKAGE_ID,
        fixture.root,
        OLD_VERSION,
        NEW_VERSION
      );

      assert.equal(
        verifiedAfterRecovery,
        true
      );

      assert.equal(
        await fs.readFile(
          sentinel,
          "utf8"
        ),
        "before interruption\n"
      );

      await fs.access(
        recoveredTransactionDirectory(
          fixture.root,
          INTERRUPTED_TRANSACTION_ID
        )
      );

      const journals =
        await readActiveJournals(
          fixture.root
        );

      assert.equal(
        journals.length,
        1
      );

      assert.equal(
        journals[0].operation,
        "update"
      );

      assert.equal(
        journals[0].phase,
        "committed"
      );

      assert.deepEqual(
        await new LifecycleJournalStore(
          fixture.root
        ).listIncomplete(),
        []
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
