import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

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
  DependencyInspector,
} =
  await loadDist(
    "packages/uninstall/dependencyInspector.js"
  );


const {
  PackageOwnershipUninstaller,
} =
  await loadDist(
    "packages/uninstall/packageOwnershipUninstaller.js"
  );


const {
  UninstallManager,
} =
  await loadDist(
    "packages/uninstall/uninstallManager.js"
  );


const {
  InstalledStateVerifier,
} =
  await loadDist(
    "packages/verify/installedStateVerifier.js"
  );


const TARGET =
  "durable-uninstall-target";

const OTHER =
  "durable-uninstall-other";

const VERSION =
  "1.0.0";

const INSTALLED_AT =
  "2026-08-20T12:00:00.000Z";

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
  id,
  overrides = {}
) {
  return {
    id,

    version:
      VERSION,

    publisherId:
      "aurora-tests",

    artifactSha256:
      "a".repeat(64),

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
  prefix,
  includeOther = true
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

  const ownedFile =
    path.join(
      root,
      "owned.txt"
    );

  const ownedContent =
    "durable uninstall ownership\n";

  const targetReceipt =
    receipt(
      TARGET,
      {
        files: [
          {
            path:
              "owned.txt",

            action:
              "created",

            sha256:
              sha256(
                ownedContent
              ),

            previousSha256:
              null,
          },
        ],
      }
    );

  const receipts = [
    targetReceipt,
  ];

  if (includeOther) {
    receipts.push(
      receipt(
        OTHER
      )
    );
  }

  const packages =
    Object.fromEntries(
      receipts.map(
        candidate => [
          candidate.id,
          candidate,
        ]
      )
    );

  const cache =
    Object.fromEntries(
      receipts.map(
        candidate => [
          candidate.id,
          {
            version:
              candidate.version,

            installedAt:
              candidate.installedAt,

            verified:
              true,
          },
        ]
      )
    );

  const lockPackages =
    Object.fromEntries(
      receipts.map(
        candidate => [
          candidate.id,
          candidate.version,
        ]
      )
    );

  await writeJson(
    stateFile,
    {
      schemaVersion: 1,
      packages,
    }
  );

  await writeJson(
    cacheFile,
    cache
  );

  await writeJson(
    lockFile,
    {
      packages:
        lockPackages,
    }
  );

  await writeJson(
    path.join(
      root,
      "package.json"
    ),
    {
      name:
        "durable-uninstall-fixture",

      private:
        true,

      dependencies: {},
    }
  );

  await fs.writeFile(
    path.join(
      root,
      ".env.example"
    ),
    "",
    "utf8"
  );

  await fs.writeFile(
    ownedFile,
    ownedContent,
    "utf8"
  );

  return {
    root,
    stateFile,
    cacheFile,
    lockFile,
    ownedFile,
    ownedContent,
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

  for (const entry of entries) {
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
  "UninstallManager commits one durable uninstall through every phase while holding lifecycle authority",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-uninstall-success-"
      );

    const originalFindDependents =
      DependencyInspector
        .prototype
        .findDependents;

    const originalApply =
      PackageOwnershipUninstaller
        .prototype
        .apply;

    const originalVerifyReceipt =
      InstalledStateVerifier
        .prototype
        .verifyReceipt;

    let mutationObserved =
      false;

    let verificationObserved =
      false;

    DependencyInspector
      .prototype
      .findDependents =
        async () => [];

    PackageOwnershipUninstaller
      .prototype
      .apply =
        async function (
          plan
        ) {
          const journal =
            await readOnlyJournal(
              fixture.root
            );

          assert.equal(
            journal.phase,
            "mutating"
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
            ]
          );

          await fs.access(
            lifecycleLockPath(
              fixture.root
            )
          );

          mutationObserved =
            true;

          return originalApply.call(
            this,
            plan
          );
        };

    InstalledStateVerifier
      .prototype
      .verifyReceipt =
        async function (
          packageId,
          projectPath,
          installedReceipt
        ) {
          assert.equal(
            packageId,
            OTHER
          );

          const journal =
            await readOnlyJournal(
              fixture.root
            );

          assert.equal(
            journal.phase,
            "verifying"
          );

          await assertMissing(
            fixture.ownedFile
          );

          await fs.access(
            lifecycleLockPath(
              fixture.root
            )
          );

          verificationObserved =
            true;

          return originalVerifyReceipt.call(
            this,
            packageId,
            projectPath,
            installedReceipt
          );
        };

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
        );

      assert.equal(
        mutationObserved,
        true
      );

      assert.equal(
        verificationObserved,
        true
      );

      const journal =
        await readOnlyJournal(
          fixture.root
        );

      assert.equal(
        journal.operation,
        "uninstall"
      );

      assert.equal(
        journal.phase,
        "committed"
      );

      assert.deepEqual(
        journal.packageIds,
        [
          TARGET,
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
          "owned.txt",
        ]
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

      assert.deepEqual(
        Object.keys(
          state.packages
        ),
        [
          OTHER,
        ]
      );

      assert.deepEqual(
        Object.keys(cache),
        [
          OTHER,
        ]
      );

      assert.deepEqual(
        Object.keys(
          lock.packages
        ),
        [
          OTHER,
        ]
      );

      await assertMissing(
        fixture.ownedFile
      );

      await assertMissing(
        lifecycleLockPath(
          fixture.root
        )
      );
    }
    finally {
      DependencyInspector
        .prototype
        .findDependents =
          originalFindDependents;

      PackageOwnershipUninstaller
        .prototype
        .apply =
          originalApply;

      InstalledStateVerifier
        .prototype
        .verifyReceipt =
          originalVerifyReceipt;

      await cleanup(
        fixture
      );
    }
  }
);


test(
  "handled uninstall verification failure rolls back before lock release and retains incomplete durable evidence",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-uninstall-rollback-"
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

    const originalFindDependents =
      DependencyInspector
        .prototype
        .findDependents;

    const originalVerifyReceipt =
      InstalledStateVerifier
        .prototype
        .verifyReceipt;

    let failureObserved =
      false;

    DependencyInspector
      .prototype
      .findDependents =
        async () => [];

    InstalledStateVerifier
      .prototype
      .verifyReceipt =
        async function () {
          const journal =
            await readOnlyJournal(
              fixture.root
            );

          assert.equal(
            journal.phase,
            "verifying"
          );

          await assertMissing(
            fixture.ownedFile
          );

          await fs.access(
            lifecycleLockPath(
              fixture.root
            )
          );

          failureObserved =
            true;

          throw new Error(
            "forced-durable-uninstall-verification-failure"
          );
        };

    try {
      await assert.rejects(
        new UninstallManager()
          .uninstall(
            TARGET,
            fixture.root
          ),
        /forced-durable-uninstall-verification-failure/u
      );

      assert.equal(
        failureObserved,
        true
      );

      assert.equal(
        await fs.readFile(
          fixture.ownedFile,
          "utf8"
        ),
        fixture.ownedContent
      );

      assert.deepEqual(
        await fs.readFile(
          fixture.stateFile
        ),
        beforeState
      );

      assert.deepEqual(
        await fs.readFile(
          fixture.cacheFile
        ),
        beforeCache
      );

      assert.deepEqual(
        await fs.readFile(
          fixture.lockFile
        ),
        beforeLock
      );

      const journal =
        await readOnlyJournal(
          fixture.root
        );

      assert.equal(
        journal.operation,
        "uninstall"
      );

      assert.equal(
        journal.phase,
        "verifying"
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
      DependencyInspector
        .prototype
        .findDependents =
          originalFindDependents;

      InstalledStateVerifier
        .prototype
        .verifyReceipt =
          originalVerifyReceipt;

      await cleanup(
        fixture
      );
    }
  }
);


test(
  "UninstallManager recovers an interrupted transaction before verifying and starting the next uninstall",
  async () => {
    const fixture =
      await createProject(
        "aurora-durable-uninstall-recovery-",
        false
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
            "interrupted package uninstall",

          operation:
            "uninstall",

          packageIds: [
            TARGET,
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
      "interrupted mutation\n",
      "utf8"
    );

    const originalVerify =
      InstalledStateVerifier
        .prototype
        .verify;

    let verifiedAfterRecovery =
      false;

    InstalledStateVerifier
      .prototype
      .verify =
        async function (
          packageId,
          projectPath
        ) {
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

          return originalVerify.call(
            this,
            packageId,
            projectPath
          );
        };

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
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
        "uninstall"
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
      InstalledStateVerifier
        .prototype
        .verify =
          originalVerify;

      await cleanup(
        fixture
      );
    }
  }
);
