import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
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
  LIFECYCLE_JOURNAL_BLOB_MAX_BYTES,
  LIFECYCLE_JOURNAL_MAX_BYTES,
  assertLifecycleJournalPhaseTransition,
  createLifecycleJournalEnvelope,
  parseLifecycleJournal,
  serializeLifecycleJournal,
} from "../../dist/packages/lifecycle/lifecycleJournalSchema.js";

import {
  durableWriteFile,
} from "../../dist/packages/lifecycle/durableFileWriter.js";

import {
  LIFECYCLE_JOURNAL_RELATIVE_ROOT,
  LifecycleJournalStore,
} from "../../dist/packages/lifecycle/lifecycleJournalStore.js";

const TRANSACTION_ONE =
  "11111111-1111-4111-8111-111111111111";

const TRANSACTION_TWO =
  "22222222-2222-4222-8222-222222222222";

const TIMESTAMP =
  "2026-08-19T17:30:00.000Z";

function journal(
  overrides = {}
) {
  return {
    schemaVersion: 1,
    transactionId:
      TRANSACTION_ONE,
    projectRootSha256:
      "a".repeat(64),
    operation:
      "update",
    packageIds: [
      "database",
      "auth",
    ],
    phase:
      "prepared",
    createdAt:
      TIMESTAMP,
    updatedAt:
      TIMESTAMP,
    files: [],
    directories: [],
    ...overrides,
  };
}

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

function journalDirectory(
  project,
  transactionId
) {
  return join(
    project,
    ".aurora",
    "lifecycle-journal",
    transactionId
  );
}

function journalFile(
  project,
  transactionId
) {
  return join(
    journalDirectory(
      project,
      transactionId
    ),
    "journal.json"
  );
}

test(
  "Lifecycle Journal v1 schema is strict and rejects unsafe or duplicate paths",
  () => {
    assert.doesNotThrow(
      () =>
        parseLifecycleJournal(
          journal()
        )
    );

    assert.throws(
      () =>
        parseLifecycleJournal(
          journal({
            unexpected: true,
          })
        )
    );

    assert.throws(
      () =>
        parseLifecycleJournal(
          journal({
            files: [
              {
                path:
                  "../outside.txt",
                kind:
                  "absent",
              },
            ],
          })
        )
    );

    assert.throws(
      () =>
        parseLifecycleJournal(
          journal({
            files: [
              {
                path:
                  "src/auth.ts",
                kind:
                  "absent",
              },
              {
                path:
                  "SRC/AUTH.TS",
                kind:
                  "absent",
              },
            ],
          })
        )
    );

    assert.throws(
      () =>
        parseLifecycleJournal(
          journal({
            directories: [
              {
                path:
                  ".aurora/lifecycle-journal/escape",
                kind:
                  "absent",
              },
            ],
          })
        )
    );
  }
);

test(
  "Lifecycle Journal v1 serialization and envelope digests are deterministic",
  () => {
    const first =
      journal({
        files: [
          {
            path:
              "z-last.txt",
            kind:
              "absent",
          },
          {
            path:
              "a-first.txt",
            kind:
              "absent",
          },
        ],
        directories: [
          {
            path:
              "z-dir",
            kind:
              "absent",
          },
          {
            path:
              "a-dir",
            kind:
              "absent",
          },
        ],
      });

    const second =
      journal({
        packageIds: [
          "auth",
          "database",
        ],
        files: [
          {
            path:
              "a-first.txt",
            kind:
              "absent",
          },
          {
            path:
              "z-last.txt",
            kind:
              "absent",
          },
        ],
        directories: [
          {
            path:
              "a-dir",
            kind:
              "absent",
          },
          {
            path:
              "z-dir",
            kind:
              "absent",
          },
        ],
      });

    assert.equal(
      serializeLifecycleJournal(
        first
      ),
      serializeLifecycleJournal(
        second
      )
    );

    assert.equal(
      createLifecycleJournalEnvelope(
        first
      ).digest,
      createLifecycleJournalEnvelope(
        second
      ).digest
    );
  }
);

test(
  "Lifecycle Journal v1 phase transitions are monotonic and idempotent",
  () => {
    assert.doesNotThrow(
      () =>
        assertLifecycleJournalPhaseTransition(
          "prepared",
          "prepared"
        )
    );

    assert.doesNotThrow(
      () =>
        assertLifecycleJournalPhaseTransition(
          "prepared",
          "mutating"
        )
    );

    assert.throws(
      () =>
        assertLifecycleJournalPhaseTransition(
          "prepared",
          "verifying"
        )
    );

    assert.throws(
      () =>
        assertLifecycleJournalPhaseTransition(
          "committed",
          "mutating"
        )
    );
  }
);

test(
  "durableWriteFile atomically replaces content and leaves no temporary sibling",
  async () => {
    const project =
      await temporaryProject(
        "aurora-durable-write-"
      );

    try {
      const file =
        join(
          project,
          "nested",
          "journal.json"
        );

      await durableWriteFile(
        file,
        "first"
      );

      await durableWriteFile(
        file,
        "second"
      );

      assert.equal(
        await readFile(
          file,
          "utf8"
        ),
        "second"
      );

      assert.deepEqual(
        await readdir(
          join(
            project,
            "nested"
          )
        ),
        [
          "journal.json",
        ]
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
  "LifecycleJournalStore creates a prepared project-bound journal and reads it idempotently",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-create-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      const created =
        await store.create({
          transactionId:
            TRANSACTION_ONE,
          operation:
            "install",
          packageIds: [
            "database",
            "auth",
          ],
          timestamp:
            TIMESTAMP,
        });

      assert.equal(
        created.phase,
        "prepared"
      );

      assert.deepEqual(
        created.packageIds,
        [
          "auth",
          "database",
        ]
      );

      assert.deepEqual(
        await store.read(
          TRANSACTION_ONE
        ),
        await store.read(
          TRANSACTION_ONE
        )
      );

      await assert.rejects(
        store.create({
          transactionId:
            TRANSACTION_ONE,
          operation:
            "install",
          packageIds: [
            "auth",
          ],
          timestamp:
            TIMESTAMP,
        })
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
  "LifecycleJournalStore rejects a journal copied into a different project root",
  async () => {
    const source =
      await temporaryProject(
        "aurora-journal-source-"
      );

    const destination =
      await temporaryProject(
        "aurora-journal-destination-"
      );

    try {
      const sourceStore =
        new LifecycleJournalStore(
          source
        );

      await sourceStore.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      await mkdir(
        join(
          destination,
          ".aurora",
          "lifecycle-journal"
        ),
        {
          recursive: true,
        }
      );

      await cp(
        journalDirectory(
          source,
          TRANSACTION_ONE
        ),
        journalDirectory(
          destination,
          TRANSACTION_ONE
        ),
        {
          recursive: true,
        }
      );

      const destinationStore =
        new LifecycleJournalStore(
          destination
        );

      await assert.rejects(
        destinationStore.read(
          TRANSACTION_ONE
        ),
        /different project root/u
      );
    }
    finally {
      await rm(
        source,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        destination,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "LifecycleJournalStore durably captures and reuses an existing file before-image",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-capture-"
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

      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      const captured =
        await store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "config.txt"
        );

      assert.equal(
        captured.kind,
        "file"
      );

      assert.equal(
        captured.size,
        Buffer.byteLength(
          "before"
        )
      );

      await writeFile(
        target,
        "after",
        "utf8"
      );

      assert.deepEqual(
        await store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "config.txt"
        ),
        captured
      );

      assert.equal(
        (
          await store.readBeforeImage(
            TRANSACTION_ONE,
            "config.txt"
          )
        )?.toString("utf8"),
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

test(
  "LifecycleJournalStore records an absent file before-image idempotently",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-absent-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "install",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      const captured =
        await store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "missing.txt"
        );

      assert.deepEqual(
        captured,
        {
          path:
            "missing.txt",
          kind:
            "absent",
        }
      );

      await writeFile(
        join(
          project,
          "missing.txt"
        ),
        "created later",
        "utf8"
      );

      assert.deepEqual(
        await store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "missing.txt"
        ),
        captured
      );

      assert.equal(
        await store.readBeforeImage(
          TRANSACTION_ONE,
          "missing.txt"
        ),
        null
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
  "LifecycleJournalStore rejects project paths through a symlink or junction",
  async t => {
    const project =
      await temporaryProject(
        "aurora-journal-boundary-"
      );

    const outside =
      await temporaryProject(
        "aurora-journal-outside-"
      );

    try {
      await writeFile(
        join(
          outside,
          "secret.txt"
        ),
        "outside",
        "utf8"
      );

      try {
        await symlink(
          outside,
          join(
            project,
            "linked"
          ),
          process.platform === "win32"
            ? "junction"
            : "dir"
        );
      }
      catch (error) {
        if (
          error?.code === "EPERM" ||
          error?.code === "EACCES"
        ) {
          t.skip(
            "This environment does not permit creating the test link."
          );
          return;
        }

        throw error;
      }

      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      await assert.rejects(
        store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "linked/secret.txt"
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
  "LifecycleJournalStore fails closed when a before-image blob is tampered",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-blob-tamper-"
      );

    try {
      await writeFile(
        join(
          project,
          "config.txt"
        ),
        "trusted",
        "utf8"
      );

      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      const entry =
        await store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "config.txt"
        );

      assert.equal(
        entry.kind,
        "file"
      );

      await writeFile(
        join(
          journalDirectory(
            project,
            TRANSACTION_ONE
          ),
          "blobs",
          `${entry.sha256}.bin`
        ),
        "tampered",
        "utf8"
      );

      await assert.rejects(
        store.read(
          TRANSACTION_ONE
        ),
        /verification failed/u
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
  "LifecycleJournalStore fails closed when journal semantics change without a matching digest",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-digest-tamper-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      const file =
        journalFile(
          project,
          TRANSACTION_ONE
        );

      const envelope =
        JSON.parse(
          await readFile(
            file,
            "utf8"
          )
        );

      envelope.journal.operation =
        "uninstall";

      await writeFile(
        file,
        JSON.stringify(
          envelope,
          null,
          2
        ),
        "utf8"
      );

      await assert.rejects(
        store.read(
          TRANSACTION_ONE
        ),
        /digest verification failed/u
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
  "LifecycleJournalStore rejects truncated or oversized journal files",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-corrupt-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      const file =
        journalFile(
          project,
          TRANSACTION_ONE
        );

      await writeFile(
        file,
        "{\"digest\":",
        "utf8"
      );

      await assert.rejects(
        store.read(
          TRANSACTION_ONE
        ),
        /invalid JSON/u
      );

      await writeFile(
        file,
        Buffer.alloc(
          LIFECYCLE_JOURNAL_MAX_BYTES +
          1,
          0x20
        )
      );

      await assert.rejects(
        store.read(
          TRANSACTION_ONE
        ),
        /maximum supported size/u
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
  "LifecycleJournalStore rejects an oversized before-image before reading it into the journal",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-large-blob-"
      );

    try {
      const file =
        join(
          project,
          "large.bin"
        );

      await writeFile(
        file,
        Buffer.alloc(1)
      );

      await truncate(
        file,
        LIFECYCLE_JOURNAL_BLOB_MAX_BYTES +
        1
      );

      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "install",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      await assert.rejects(
        store.captureFileBeforeImage(
          TRANSACTION_ONE,
          "large.bin"
        ),
        /maximum supported size/u
      );

      assert.equal(
        (
          await store.read(
            TRANSACTION_ONE
          )
        ).files.length,
        0
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
  "LifecycleJournalStore captures absent and existing directory before-images idempotently",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-directory-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "install",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      const absent =
        await store.captureDirectoryBeforeImage(
          TRANSACTION_ONE,
          "generated/cache"
        );

      assert.deepEqual(
        absent,
        {
          path:
            "generated/cache",
          kind:
            "absent",
        }
      );

      await mkdir(
        join(
          project,
          "already-there"
        )
      );

      const existing =
        await store.captureDirectoryBeforeImage(
          TRANSACTION_ONE,
          "already-there"
        );

      assert.equal(
        existing.kind,
        "directory"
      );

      assert.deepEqual(
        await store.captureDirectoryBeforeImage(
          TRANSACTION_ONE,
          "generated/cache"
        ),
        absent
      );

      assert.deepEqual(
        (
          await store.read(
            TRANSACTION_ONE
          )
        ).directories.map(
          item =>
            item.path
        ),
        [
          "already-there",
          "generated/cache",
        ]
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
  "LifecycleJournalStore persists the complete phase sequence and excludes committed transactions from recovery discovery",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-phases-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "update",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      await store.create({
        transactionId:
          TRANSACTION_TWO,
        operation:
          "uninstall",
        packageIds: [
          "database",
        ],
        timestamp:
          TIMESTAMP,
      });

      assert.deepEqual(
        (
          await store.listIncomplete()
        ).map(
          item =>
            item.transactionId
        ),
        [
          TRANSACTION_ONE,
          TRANSACTION_TWO,
        ]
      );

      await store.transition(
        TRANSACTION_ONE,
        "mutating"
      );

      await assert.rejects(
        store.transition(
          TRANSACTION_TWO,
          "verifying"
        )
      );

      await store.transition(
        TRANSACTION_ONE,
        "verifying"
      );

      await store.transition(
        TRANSACTION_ONE,
        "committed"
      );

      const committed =
        await store.transition(
          TRANSACTION_ONE,
          "committed"
        );

      assert.equal(
        committed.phase,
        "committed"
      );

      assert.deepEqual(
        (
          await store.listIncomplete()
        ).map(
          item =>
            item.transactionId
        ),
        [
          TRANSACTION_TWO,
        ]
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
  "LifecycleJournalStore discovery fails closed on an unexpected transaction entry",
  async () => {
    const project =
      await temporaryProject(
        "aurora-journal-discovery-"
      );

    try {
      const store =
        new LifecycleJournalStore(
          project
        );

      await store.create({
        transactionId:
          TRANSACTION_ONE,
        operation:
          "install",
        packageIds: [
          "auth",
        ],
        timestamp:
          TIMESTAMP,
      });

      await mkdir(
        join(
          project,
          LIFECYCLE_JOURNAL_RELATIVE_ROOT,
          "not-a-transaction"
        )
      );

      await assert.rejects(
        store.listIncomplete()
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
