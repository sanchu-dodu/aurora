import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
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
  FileTransaction,
} from "../../dist/core/fileTransaction.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  DurableFileTransaction,
} from "../../dist/packages/lifecycle/durableFileTransaction.js";

import {
  LifecycleJournalStore,
} from "../../dist/packages/lifecycle/lifecycleJournalStore.js";

const TRANSACTION_ONE =
  "33333333-3333-4333-8333-333333333333";

const TIMESTAMP =
  "2026-08-19T19:03:00.000Z";

async function temporaryProject(
  prefix
) {
  return mkdtemp(
    join(
      tmpdir(),
      prefix
    )
  );
}

async function beginTransaction(
  project,
  {
    operation =
      "update",

    packageIds = [
      "auth",
    ],

    transactionId =
      TRANSACTION_ONE,
  } = {}
) {
  return DurableFileTransaction
    .begin({
      operationName:
        `package ${operation}`,

      operation,

      packageIds,

      projectPath:
        project,

      transactionId,

      timestamp:
        TIMESTAMP,
    });
}

function journalFile(
  project,
  transactionId =
    TRANSACTION_ONE
) {
  return join(
    project,
    ".aurora",
    "lifecycle-journal",
    transactionId,
    "journal.json"
  );
}

async function assertMissing(
  target
) {
  await assert.rejects(
    access(
      target
    ),
    error =>
      error?.code ===
      "ENOENT"
  );
}

test(
  "DurableFileTransaction creates a prepared journal and remains FileTransaction-compatible",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-create-"
      );

    try {
      const transaction =
        await beginTransaction(
          project
        );

      assert.ok(
        transaction instanceof
          FileTransaction
      );

      const context =
        new InstallerContext(
          project,
          transaction
        );

      assert.equal(
        context.transaction,
        transaction
      );

      assert.equal(
        transaction.transactionId,
        TRANSACTION_ONE
      );

      const journal =
        await transaction
          .readJournal();

      assert.equal(
        journal.phase,
        "prepared"
      );

      assert.equal(
        journal.operation,
        "update"
      );

      assert.deepEqual(
        journal.packageIds,
        [
          "auth",
        ]
      );

      assert.throws(
        () =>
          transaction.commit(),
        /commitDurably/u
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
    }
  }
);

test(
  "DurableFileTransaction persists existing and absent file before-images and handled rollback leaves the journal incomplete",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-files-"
      );

    try {
      const existing =
        join(
          project,
          "config.txt"
        );

      const created =
        join(
          project,
          "created.txt"
        );

      await writeFile(
        existing,
        "before",
        "utf8"
      );

      const transaction =
        await beginTransaction(
          project
        );

      const store =
        new LifecycleJournalStore(
          project
        );

      await transaction
        .recordModifiedFile(
          existing
        );

      await transaction
        .recordModifiedFile(
          created
        );

      assert.equal(
        (
          await store
            .readBeforeImage(
              TRANSACTION_ONE,
              "config.txt"
            )
        )?.toString(
          "utf8"
        ),
        "before"
      );

      assert.equal(
        await store
          .readBeforeImage(
            TRANSACTION_ONE,
            "created.txt"
          ),
        null
      );

      await transaction
        .beginMutation();

      await writeFile(
        existing,
        "after",
        "utf8"
      );

      await writeFile(
        created,
        "new",
        "utf8"
      );

      assert.throws(
        () =>
          transaction.commit(),
        /commitDurably/u
      );

      await transaction
        .rollback();

      assert.equal(
        await readFile(
          existing,
          "utf8"
        ),
        "before"
      );

      await assertMissing(
        created
      );

      const incomplete =
        await store
          .listIncomplete();

      assert.equal(
        incomplete.length,
        1
      );

      assert.equal(
        incomplete[0]
          .transactionId,
        TRANSACTION_ONE
      );

      assert.equal(
        incomplete[0]
          .phase,
        "mutating"
      );

      await assert.rejects(
        transaction
          .recordModifiedFile(
            existing
          ),
        /already closed/u
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
    }
  }
);

test(
  "DurableFileTransaction rejects the legacy synchronous recordCreatedFile surface",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-created-file-"
      );

    try {
      const transaction =
        await beginTransaction(
          project,
          {
            operation:
              "install",
          }
        );

      assert.throws(
        () =>
          transaction
            .recordCreatedFile(
              join(
                project,
                "created.txt"
              )
            ),
        /recordModifiedFile/u
      );

      const journal =
        await transaction
          .readJournal();

      assert.deepEqual(
        journal.files,
        []
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
    }
  }
);

test(
  "DurableFileTransaction enforces prepared to mutating to verifying to committed ordering",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-phases-"
      );

    try {
      const target =
        join(
          project,
          "state.txt"
        );

      await writeFile(
        target,
        "before",
        "utf8"
      );

      const transaction =
        await beginTransaction(
          project
        );

      const store =
        new LifecycleJournalStore(
          project
        );

      await transaction
        .recordModifiedFile(
          target
        );

      await assert.rejects(
        transaction
          .beginVerification(),
        /Invalid lifecycle journal phase transition 'prepared' -> 'verifying'/u
      );

      assert.equal(
        (
          await transaction
            .beginMutation()
        ).phase,
        "mutating"
      );

      await writeFile(
        target,
        "after",
        "utf8"
      );

      await assert.rejects(
        transaction
          .commitDurably(),
        /Invalid lifecycle journal phase transition 'mutating' -> 'committed'/u
      );

      assert.equal(
        (
          await transaction
            .beginVerification()
        ).phase,
        "verifying"
      );

      assert.equal(
        (
          await transaction
            .commitDurably()
        ).phase,
        "committed"
      );

      assert.equal(
        (
          await store
            .read(
              TRANSACTION_ONE
            )
        ).phase,
        "committed"
      );

      assert.deepEqual(
        await store
          .listIncomplete(),
        []
      );

      assert.equal(
        await readFile(
          target,
          "utf8"
        ),
        "after"
      );

      await assert.rejects(
        transaction
          .rollback(),
        /already closed/u
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
    }
  }
);

test(
  "DurableFileTransaction journals every missing directory before recursive creation and rollback removes them",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-directories-"
      );

    try {
      const generated =
        join(
          project,
          "generated"
        );

      const nested =
        join(
          generated,
          "child"
        );

      const transaction =
        await beginTransaction(
          project,
          {
            operation:
              "install",
          }
        );

      await assert.rejects(
        transaction
          .ensureDirectory(
            nested
          ),
        /requires journal phase 'mutating'/u
      );

      await assertMissing(
        nested
      );

      await transaction
        .beginMutation();

      await transaction
        .ensureDirectory(
          nested
        );

      await access(
        nested
      );

      const journal =
        await transaction
          .readJournal();

      assert.deepEqual(
        journal.directories
          .map(
            entry => ({
              path:
                entry.path,

              kind:
                entry.kind,
            })
          ),
        [
          {
            path:
              "generated",
            kind:
              "absent",
          },
          {
            path:
              "generated/child",
            kind:
              "absent",
          },
        ]
      );

      await transaction
        .rollback();

      await assertMissing(
        nested
      );

      await assertMissing(
        generated
      );

      const store =
        new LifecycleJournalStore(
          project
        );

      const incomplete =
        await store
          .listIncomplete();

      assert.equal(
        incomplete.length,
        1
      );

      assert.equal(
        incomplete[0]
          .phase,
        "mutating"
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
    }
  }
);

test(
  "DurableFileTransaction persists an existing directory mode before-image",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-directory-mode-"
      );

    try {
      const directory =
        join(
          project,
          "existing"
        );

      await mkdir(
        directory
      );

      const transaction =
        await beginTransaction(
          project
        );

      await transaction
        .recordDirectoryMode(
          directory
        );

      const journal =
        await transaction
          .readJournal();

      assert.equal(
        journal.directories
          .length,
        1
      );

      assert.equal(
        journal.directories[0]
          .path,
        "existing"
      );

      assert.equal(
        journal.directories[0]
          .kind,
        "directory"
      );

      assert.equal(
        typeof journal
          .directories[0]
          .mode,
        "number"
      );

      await transaction
        .rollback();
    }
    finally {
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
  "DurableFileTransaction rejects resources outside the project boundary before recording or creating them",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-boundary-"
      );

    const outside =
      await temporaryProject(
        "aurora-durable-transaction-outside-"
      );

    try {
      const outsideFile =
        join(
          outside,
          "outside.txt"
        );

      const outsideDirectory =
        join(
          outside,
          "generated"
        );

      await writeFile(
        outsideFile,
        "outside",
        "utf8"
      );

      const transaction =
        await beginTransaction(
          project
        );

      await assert.rejects(
        transaction
          .recordModifiedFile(
            outsideFile
          )
      );

      await transaction
        .beginMutation();

      await assert.rejects(
        transaction
          .ensureDirectory(
            outsideDirectory
          )
      );

      const journal =
        await transaction
          .readJournal();

      assert.deepEqual(
        journal.files,
        []
      );

      assert.deepEqual(
        journal.directories,
        []
      );

      await transaction
        .rollback();

      assert.equal(
        await readFile(
          outsideFile,
          "utf8"
        ),
        "outside"
      );

      await assertMissing(
        outsideDirectory
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
        outside,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "DurableFileTransaction fails closed on journal tampering while RAM rollback remains available",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-transaction-tamper-"
      );

    try {
      const target =
        join(
          project,
          "config.txt"
        );

      await writeFile(
        target,
        "before",
        "utf8"
      );

      const transaction =
        await beginTransaction(
          project
        );

      await transaction
        .recordModifiedFile(
          target
        );

      await transaction
        .beginMutation();

      await writeFile(
        target,
        "after",
        "utf8"
      );

      await writeFile(
        journalFile(
          project
        ),
        "{}\n",
        "utf8"
      );

      /*
       * A corrupted journal must prevent any further durable
       * phase advancement.
       */
      await assert.rejects(
        transaction
          .beginVerification()
      );

      /*
       * The active process still owns the already-proven RAM
       * before-image and can perform its ordinary handled
       * rollback. The corrupted journal remains fail-closed
       * for the future recovery layer.
       */
      await transaction
        .rollback();

      assert.equal(
        await readFile(
          target,
          "utf8"
        ),
        "before"
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
    }
  }
);