import assert from "node:assert/strict";

import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import test from "node:test";

import {
  PackageInstaller,
} from "../../dist/packages/installer/packageInstaller.js";

import {
  DurableFileTransaction,
} from "../../dist/packages/lifecycle/durableFileTransaction.js";

import {
  LifecycleRecoveryManager,
} from "../../dist/packages/lifecycle/lifecycleRecoveryManager.js";

import {
  LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT,
  LIFECYCLE_JOURNAL_RELATIVE_ROOT,
  LifecycleJournalStore,
} from "../../dist/packages/lifecycle/lifecycleJournalStore.js";

import {
  ProjectLifecycleLock,
} from "../../dist/packages/lifecycle/projectLifecycleLock.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";


const TRANSACTION_ONE =
  "11111111-1111-4111-8111-111111111111";

const TRANSACTION_TWO =
  "22222222-2222-4222-8222-222222222222";

const TIMESTAMP_ONE =
  "2026-08-20T08:00:00.000Z";

const TIMESTAMP_TWO =
  "2026-08-20T08:01:00.000Z";

const LOCK_OPTIONS = {
  acquisitionTimeoutMs:
    500,

  pollIntervalMs:
    5,
};


async function temporaryProject(
  prefix
) {
  const project =
    await mkdtemp(
      join(
        tmpdir(),
        prefix
      )
    );

  await writeFile(
    join(
      project,
      "package.json"
    ),
    `${JSON.stringify(
      {
        name:
          "lifecycle-recovery-test",

        version:
          "1.0.0",

        private:
          true,

        type:
          "module",

        dependencies: {},
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return project;
}


async function assertMissing(
  target
) {
  await assert.rejects(
    access(target),
    error =>
      error?.code ===
        "ENOENT"
  );
}


function activeTransactionDirectory(
  project,
  transactionId
) {
  return join(
    project,
    LIFECYCLE_JOURNAL_RELATIVE_ROOT,
    transactionId
  );
}


function recoveredTransactionDirectory(
  project,
  transactionId
) {
  return join(
    project,
    LIFECYCLE_JOURNAL_RECOVERED_RELATIVE_ROOT,
    transactionId
  );
}


async function releaseIfHeld(
  lock
) {
  if (lock?.isHeld) {
    await lock.release();
  }
}


test(
  "LifecycleRecoveryManager requires verified lock authority for the same project",
  async () => {
    const project =
      await temporaryProject(
        "aurora-lifecycle-recovery-authority-"
      );

    const otherProject =
      await temporaryProject(
        "aurora-lifecycle-recovery-other-"
      );

    let projectLock;
    let otherLock;

    try {
      const recovery =
        new LifecycleRecoveryManager(
          project
        );

      await assert.rejects(
        recovery.recoverIncomplete(),
        /requires a held project lifecycle lock/u
      );

      otherLock =
        await ProjectLifecycleLock
          .acquire(
            otherProject,
            LOCK_OPTIONS
          );

      await assert.rejects(
        recovery.recoverIncomplete(
          otherLock
        ),
        /different project root/u
      );

      await otherLock.release();

      projectLock =
        await ProjectLifecycleLock
          .acquire(
            project,
            LOCK_OPTIONS
          );

      await projectLock.release();

      await assert.rejects(
        recovery.recoverIncomplete(
          projectLock
        ),
        /requires a held project lifecycle lock/u
      );
    }
    finally {
      await releaseIfHeld(
        projectLock
      );

      await releaseIfHeld(
        otherLock
      );

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        otherProject,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "LifecycleRecoveryManager restores durable before-images and archives the recovered journal exactly once",
  async () => {
    const project =
      await temporaryProject(
        "aurora-lifecycle-recovery-restore-"
      );

    let lock;

    try {
      const configDirectory =
        join(
          project,
          "config"
        );

      const existingFile =
        join(
          configDirectory,
          "settings.txt"
        );

      const generatedDirectory =
        join(
          project,
          "generated"
        );

      const generatedNested =
        join(
          generatedDirectory,
          "nested"
        );

      const createdFile =
        join(
          generatedNested,
          "output.txt"
        );

      await mkdir(
        configDirectory
      );

      await chmod(
        configDirectory,
        0o750
      );

      await writeFile(
        existingFile,
        "before",
        "utf8"
      );

      await chmod(
        existingFile,
        0o640
      );

      const transaction =
        await DurableFileTransaction
          .begin({
            operationName:
              "recovery test",

            operation:
              "install",

            packageIds: [
              "example",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_ONE,

            timestamp:
              TIMESTAMP_ONE,
          });

      await transaction
        .recordDirectoryMode(
          configDirectory
        );

      await transaction
        .recordModifiedFile(
          existingFile
        );

      await transaction
        .recordModifiedFile(
          createdFile
        );

      await transaction
        .beginMutation();

      await transaction
        .ensureDirectory(
          generatedNested
        );

      await writeFile(
        existingFile,
        "after",
        "utf8"
      );

      await chmod(
        configDirectory,
        0o700
      );

      await chmod(
        existingFile,
        0o600
      );

      await writeFile(
        createdFile,
        "created",
        "utf8"
      );

      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            LOCK_OPTIONS
          );

      const recovery =
        new LifecycleRecoveryManager(
          project
        );

      const recovered =
        await recovery
          .recoverIncomplete(
            lock
          );

      assert.deepEqual(
        recovered.map(
          journal =>
            journal.transactionId
        ),
        [
          TRANSACTION_ONE,
        ]
      );

      assert.equal(
        await readFile(
          existingFile,
          "utf8"
        ),
        "before"
      );

      if (process.platform !== "win32") {
        assert.equal(
          (
            await stat(
              existingFile
            )
          ).mode & 0o777,
          0o640
        );

        assert.equal(
          (
            await stat(
              configDirectory
            )
          ).mode & 0o777,
          0o750
        );
      }

      await assertMissing(
        generatedDirectory
      );

      assert.deepEqual(
        await new LifecycleJournalStore(
          project
        ).listIncomplete(),
        []
      );

      await assertMissing(
        activeTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );

      await access(
        join(
          recoveredTransactionDirectory(
            project,
            TRANSACTION_ONE
          ),
          "journal.json"
        )
      );

      await writeFile(
        existingFile,
        "legitimate-after-recovery",
        "utf8"
      );

      assert.deepEqual(
        await recovery
          .recoverIncomplete(
            lock
          ),
        []
      );

      assert.equal(
        await readFile(
          existingFile,
          "utf8"
        ),
        "legitimate-after-recovery"
      );
    }
    finally {
      await releaseIfHeld(
        lock
      );

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "LifecycleRecoveryManager replays multiple journals newest first",
  async () => {
    const project =
      await temporaryProject(
        "aurora-lifecycle-recovery-order-"
      );

    let lock;

    try {
      const stateFile =
        join(
          project,
          "state.txt"
        );

      await writeFile(
        stateFile,
        "state-a",
        "utf8"
      );

      const first =
        await DurableFileTransaction
          .begin({
            operationName:
              "first interrupted operation",

            operation:
              "install",

            packageIds: [
              "first",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_ONE,

            timestamp:
              TIMESTAMP_ONE,
          });

      await first
        .recordModifiedFile(
          stateFile
        );

      await first.beginMutation();

      await writeFile(
        stateFile,
        "state-b",
        "utf8"
      );

      const second =
        await DurableFileTransaction
          .begin({
            operationName:
              "second interrupted operation",

            operation:
              "update",

            packageIds: [
              "second",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_TWO,

            timestamp:
              TIMESTAMP_TWO,
          });

      await second
        .recordModifiedFile(
          stateFile
        );

      await second.beginMutation();

      await writeFile(
        stateFile,
        "state-c",
        "utf8"
      );

      await second
        .beginVerification();

      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            LOCK_OPTIONS
          );

      const recovered =
        await new LifecycleRecoveryManager(
          project
        ).recoverIncomplete(
          lock
        );

      assert.deepEqual(
        recovered.map(
          journal =>
            journal.transactionId
        ),
        [
          TRANSACTION_TWO,
          TRANSACTION_ONE,
        ]
      );

      assert.equal(
        await readFile(
          stateFile,
          "utf8"
        ),
        "state-a"
      );

      assert.deepEqual(
        await new LifecycleJournalStore(
          project
        ).listIncomplete(),
        []
      );

      await access(
        recoveredTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );

      await access(
        recoveredTransactionDirectory(
          project,
          TRANSACTION_TWO
        )
      );
    }
    finally {
      await releaseIfHeld(
        lock
      );

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "LifecycleRecoveryManager validates every journal before changing project files",
  async () => {
    const project =
      await temporaryProject(
        "aurora-lifecycle-recovery-validation-"
      );

    let lock;

    try {
      const validFile =
        join(
          project,
          "valid.txt"
        );

      const corruptFile =
        join(
          project,
          "corrupt.txt"
        );

      await writeFile(
        validFile,
        "valid-before",
        "utf8"
      );

      await writeFile(
        corruptFile,
        "corrupt-before",
        "utf8"
      );

      const valid =
        await DurableFileTransaction
          .begin({
            operationName:
              "valid interrupted operation",

            operation:
              "install",

            packageIds: [
              "valid",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_ONE,

            timestamp:
              TIMESTAMP_ONE,
          });

      await valid
        .recordModifiedFile(
          validFile
        );

      await valid.beginMutation();

      await writeFile(
        validFile,
        "valid-after",
        "utf8"
      );

      const corrupt =
        await DurableFileTransaction
          .begin({
            operationName:
              "corrupt interrupted operation",

            operation:
              "install",

            packageIds: [
              "corrupt",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_TWO,

            timestamp:
              TIMESTAMP_TWO,
          });

      await corrupt
        .recordModifiedFile(
          corruptFile
        );

      await corrupt.beginMutation();

      await writeFile(
        corruptFile,
        "corrupt-after",
        "utf8"
      );

      const corruptJournal =
        await corrupt
          .readJournal();

      const corruptEntry =
        corruptJournal.files.find(
          entry =>
            entry.path ===
              "corrupt.txt"
        );

      assert.equal(
        corruptEntry?.kind,
        "file"
      );

      await writeFile(
        join(
          activeTransactionDirectory(
            project,
            TRANSACTION_TWO
          ),
          "blobs",
          `${corruptEntry.sha256}.bin`
        ),
        Buffer.alloc(
          corruptEntry.size,
          0x78
        )
      );

      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            LOCK_OPTIONS
          );

      await assert.rejects(
        new LifecycleRecoveryManager(
          project
        ).recoverIncomplete(
          lock
        ),
        /before-image digest verification failed/u
      );

      assert.equal(
        await readFile(
          validFile,
          "utf8"
        ),
        "valid-after"
      );

      assert.equal(
        await readFile(
          corruptFile,
          "utf8"
        ),
        "corrupt-after"
      );

      await access(
        activeTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );

      await access(
        activeTransactionDirectory(
          project,
          TRANSACTION_TWO
        )
      );
    }
    finally {
      await releaseIfHeld(
        lock
      );

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "LifecycleRecoveryManager refuses to remove unjournaled content and keeps recovery evidence active",
  async () => {
    const project =
      await temporaryProject(
        "aurora-lifecycle-recovery-nonempty-"
      );

    let lock;

    try {
      const generated =
        join(
          project,
          "generated"
        );

      const trackedFile =
        join(
          generated,
          "tracked.txt"
        );

      const untrackedFile =
        join(
          generated,
          "external.txt"
        );

      const transaction =
        await DurableFileTransaction
          .begin({
            operationName:
              "non-empty directory recovery",

            operation:
              "install",

            packageIds: [
              "nonempty",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_ONE,

            timestamp:
              TIMESTAMP_ONE,
          });

      await transaction
        .recordModifiedFile(
          trackedFile
        );

      await transaction
        .beginMutation();

      await transaction
        .ensureDirectory(
          generated
        );

      await writeFile(
        trackedFile,
        "tracked mutation",
        "utf8"
      );

      await writeFile(
        untrackedFile,
        "must be preserved",
        "utf8"
      );

      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            LOCK_OPTIONS
          );

      await assert.rejects(
        new LifecycleRecoveryManager(
          project
        ).recoverIncomplete(
          lock
        ),
        /refused to remove non-empty directory 'generated'/u
      );

      await assertMissing(
        trackedFile
      );

      assert.equal(
        await readFile(
          untrackedFile,
          "utf8"
        ),
        "must be preserved"
      );

      assert.deepEqual(
        (
          await new LifecycleJournalStore(
            project
          ).listIncomplete()
        ).map(
          journal =>
            journal.transactionId
        ),
        [
          TRANSACTION_ONE,
        ]
      );

      await access(
        activeTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );

      await assertMissing(
        recoveredTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );
    }
    finally {
      await releaseIfHeld(
        lock
      );

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "PackageInstaller recovers interrupted lifecycle state under its outer lock before starting a new transaction",
  async () => {
    const project =
      await temporaryProject(
        "aurora-lifecycle-recovery-installer-"
      );

    const packageRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-lifecycle-recovery-packages-"
        )
      );

    try {
      const sentinel =
        join(
          project,
          "sentinel.txt"
        );

      await writeFile(
        sentinel,
        "before-interruption",
        "utf8"
      );

      const interrupted =
        await DurableFileTransaction
          .begin({
            operationName:
              "interrupted package installation",

            operation:
              "install",

            packageIds: [
              "interrupted",
            ],

            projectPath:
              project,

            transactionId:
              TRANSACTION_ONE,

            timestamp:
              TIMESTAMP_ONE,
          });

      await interrupted
        .recordModifiedFile(
          sentinel
        );

      await interrupted
        .beginMutation();

      await writeFile(
        sentinel,
        "interrupted-state",
        "utf8"
      );

      const packageDirectory =
        join(
          packageRoot,
          "fresh"
        );

      await mkdir(
        packageDirectory
      );

      await writePackageManifestV1(
        packageDirectory,
        {
          id:
            "fresh",

          name:
            "fresh",
        }
      );

      await new PackageInstaller({
        packageRoot,
        projectRoot:
          project,

        trust: {
          requireSignatures:
            false,
        },
      }).install(
        "fresh"
      );

      assert.equal(
        await readFile(
          sentinel,
          "utf8"
        ),
        "before-interruption"
      );

      await access(
        recoveredTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );

      await assertMissing(
        activeTransactionDirectory(
          project,
          TRANSACTION_ONE
        )
      );

      const store =
        new LifecycleJournalStore(
          project
        );

      assert.deepEqual(
        await store.listIncomplete(),
        []
      );

      const activeEntries =
        await readdir(
          join(
            project,
            LIFECYCLE_JOURNAL_RELATIVE_ROOT
          ),
          {
            withFileTypes: true,
          }
        );

      const committedIds =
        activeEntries
          .filter(
            entry =>
              entry.isDirectory() &&
              entry.name !==
                "recovered"
          )
          .map(
            entry =>
              entry.name
          );

      assert.equal(
        committedIds.length,
        1
      );

      assert.equal(
        (
          await store.read(
            committedIds[0]
          )
        ).phase,
        "committed"
      );

      await assertMissing(
        join(
          project,
          ".aurora",
          "lifecycle-lock"
        )
      );
    }
    finally {
      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
