import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  FileTransaction,
} from "../../dist/core/fileTransaction.js";

import {
  BackupManager,
} from "../../dist/packages/backup/backupManager.js";

import {
  RollbackManager,
} from "../../dist/packages/rollback/rollbackManager.js";

import {
  TransactionManager,
} from "../../dist/packages/transaction/transactionManager.js";

import {
  RecoveryManager,
} from "../../dist/packages/recovery/recoveryManager.js";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isUnsafeProjectPath(error) {
  assert.equal(
    error.code,
    ErrorCodes.UNSAFE_PROJECT_PATH
  );

  return true;
}

test(
  "Backup and rollback preserve project-relative file locations",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-backup-"
        )
      );

    const originalPackage =
      '{"original":"package"}\n';

    const originalEnvironment =
      "ORIGINAL=true\n";

    const originalCache =
      '{"original":"cache"}\n';

    await mkdir(
      join(projectRoot, ".aurora"),
      {
        recursive: true,
      }
    );

    await writeFile(
      join(projectRoot, "package.json"),
      originalPackage,
      "utf8"
    );

    await writeFile(
      join(projectRoot, ".env.example"),
      originalEnvironment,
      "utf8"
    );

    await writeFile(
      join(
        projectRoot,
        ".aurora",
        "cache.json"
      ),
      originalCache,
      "utf8"
    );

    try {
      const backupPath =
        await new BackupManager(
          projectRoot
        ).createBackup();

      await writeFile(
        join(projectRoot, "package.json"),
        "modified package\n",
        "utf8"
      );

      await writeFile(
        join(projectRoot, ".env.example"),
        "modified environment\n",
        "utf8"
      );

      await writeFile(
        join(
          projectRoot,
          ".aurora",
          "cache.json"
        ),
        "modified cache\n",
        "utf8"
      );

      await new RollbackManager(
        projectRoot
      ).rollback(backupPath);

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "package.json"
          ),
          "utf8"
        ),
        originalPackage
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            ".env.example"
          ),
          "utf8"
        ),
        originalEnvironment
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          ),
          "utf8"
        ),
        originalCache
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "cache.json"
          )
        ),
        false
      );
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Rollback rejects a backup outside the project",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-rollback-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const outsideRoot =
      join(sandbox, "outside");

    await mkdir(
      join(
        projectRoot,
        ".aurora",
        "backups"
      ),
      {
        recursive: true,
      }
    );

    await mkdir(outsideRoot);

    await writeFile(
      join(projectRoot, "package.json"),
      "project\n",
      "utf8"
    );

    await writeFile(
      join(outsideRoot, "package.json"),
      "outside\n",
      "utf8"
    );

    try {
      await assert.rejects(
        new RollbackManager(
          projectRoot
        ).rollback(outsideRoot),
        isUnsafeProjectPath
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "package.json"
          ),
          "utf8"
        ),
        "project\n"
      );
    } finally {
      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Transaction records reject traversal identifiers",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-transaction-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const escapedFile =
      join(
        sandbox,
        "escaped-transaction.json"
      );

    await mkdir(projectRoot);

    try {
      await assert.rejects(
        new TransactionManager(
          projectRoot
        ).create(
          {
            id:
              "../../../escaped-transaction",
            package: "unsafe",
            fromVersion: "1.0.0",
            toVersion: "2.0.0",
            status: "started",
            startedAt:
              new Date().toISOString(),
          }
        ),
        isUnsafeProjectPath
      );

      assert.equal(
        await exists(escapedFile),
        false
      );
    } finally {
      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Transaction records remain discoverable and update safely",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-transaction-state-"
        )
      );

    const transaction = {
      id: "update-auth-123",
      package: "auth",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      status: "started",
      startedAt:
        new Date().toISOString(),
    };

    try {
      const manager =
        new TransactionManager(
          projectRoot
        );

      await manager.create(
        transaction
      );

      assert.deepEqual(
        await new RecoveryManager(
          projectRoot
        ).findIncomplete(),
        [
          transaction,
        ]
      );

      await manager.update(
        transaction.id,
        {
          status: "completed",
        }
      );

      assert.deepEqual(
        await new RecoveryManager(
          projectRoot
        ).findIncomplete(),
        []
      );
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Recovery refuses to read transactions through a symbolic link or junction",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-recovery-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const outsideRoot =
      join(sandbox, "outside");

    const linkPath =
      join(
        projectRoot,
        ".aurora",
        "transactions"
      );

    await mkdir(
      join(projectRoot, ".aurora"),
      {
        recursive: true,
      }
    );

    await mkdir(outsideRoot);

    await writeFile(
      join(outsideRoot, "pending.json"),
      JSON.stringify(
        {
          id: "pending",
          package: "outside",
          fromVersion: "1.0.0",
          toVersion: "2.0.0",
          status: "started",
        }
      ),
      "utf8"
    );

    try {
      await symlink(
        outsideRoot,
        linkPath,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      await assert.rejects(
        new RecoveryManager(
          projectRoot
        ).findIncomplete(),
        isUnsafeProjectPath
      );
    } finally {
      await rm(
        linkPath,
        {
          force: true,
        }
      );

      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "File transactions revalidate targets before rollback",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-file-transaction-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const outsideRoot =
      join(sandbox, "outside");

    const projectDirectory =
      join(projectRoot, "safe");

    const projectFile =
      join(projectDirectory, "file.txt");

    const outsideFile =
      join(outsideRoot, "file.txt");

    await mkdir(projectDirectory, {
      recursive: true,
    });

    await mkdir(outsideRoot);

    await writeFile(
      projectFile,
      "original\n",
      "utf8"
    );

    await writeFile(
      outsideFile,
      "outside\n",
      "utf8"
    );

    const transaction =
      new FileTransaction(
        "safe rollback test",
        projectRoot
      );

    await transaction
      .recordModifiedFile(
        projectFile
      );

    await writeFile(
      projectFile,
      "modified\n",
      "utf8"
    );

    await rm(
      projectDirectory,
      {
        recursive: true,
      }
    );

    try {
      await symlink(
        outsideRoot,
        projectDirectory,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      await transaction.rollback();

      assert.equal(
        await readFile(
          outsideFile,
          "utf8"
        ),
        "outside\n"
      );
    } finally {
      await rm(
        projectDirectory,
        {
          force: true,
        }
      );

      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
