import test from "node:test";
import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  PackageWorker,
} from "../../dist/packages/installation/packageWorker.js";

import {
  RepairManager,
} from "../../dist/packages/repair/repairManager.js";

import {
  InstalledStateVerifier,
} from "../../dist/packages/verify/installedStateVerifier.js";

import {
  VerifyManager,
} from "../../dist/packages/verify/verifyManager.js";

const PACKAGE_ID =
  "test-package";

const PACKAGE_VERSION =
  "1.0.0";

const INSTALLED_AT =
  "2026-08-19T10:00:00.000Z";

const CREATED_CONTENT =
  "created by package\n";

const MODIFIED_CONTENT =
  "modified by package\n";

const DEPENDENCY_NAME =
  "owned-dep";

const DEPENDENCY_VERSION =
  "^2.0.0";

const INTRODUCED_ENV =
  "OWNED_VARIABLE";

const PREEXISTING_ENV =
  "PREEXISTING_VARIABLE";

function sha256(
  value
) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
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

async function readJson(
  file
) {
  return JSON.parse(
    await fs.readFile(
      file,
      "utf8"
    )
  );
}

async function createHealthyProject() {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "aurora-installed-state-"
      )
    );

  const auroraDirectory =
    path.join(
      root,
      ".aurora"
    );

  const sourceDirectory =
    path.join(
      root,
      "src"
    );

  await fs.mkdir(
    auroraDirectory,
    {
      recursive: true,
    }
  );

  await fs.mkdir(
    sourceDirectory,
    {
      recursive: true,
    }
  );

  const packageJsonFile =
    path.join(
      root,
      "package.json"
    );

  const environmentFile =
    path.join(
      root,
      ".env.example"
    );

  const createdFile =
    path.join(
      sourceDirectory,
      "created.txt"
    );

  const modifiedFile =
    path.join(
      sourceDirectory,
      "modified.txt"
    );

  const cacheFile =
    path.join(
      auroraDirectory,
      "cache.json"
    );

  const stateFile =
    path.join(
      auroraDirectory,
      "package-state.json"
    );

  const lockFile =
    path.join(
      root,
      "aurora.lock"
    );

  await writeJson(
    packageJsonFile,
    {
      name:
        "installed-state-fixture",

      private:
        true,

      dependencies: {
        [DEPENDENCY_NAME]:
          DEPENDENCY_VERSION,
      },
    }
  );

  await fs.writeFile(
    environmentFile,
    [
      `${INTRODUCED_ENV}=`,
      `${PREEXISTING_ENV}=`,
      "",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    createdFile,
    CREATED_CONTENT,
    "utf8"
  );

  await fs.writeFile(
    modifiedFile,
    MODIFIED_CONTENT,
    "utf8"
  );

  const receipt = {
    id:
      PACKAGE_ID,

    version:
      PACKAGE_VERSION,

    publisherId:
      "test-publisher",

    artifactSha256:
      sha256(
        "test-package-artifact"
      ),

    installedAt:
      INSTALLED_AT,

    files: [
      {
        path:
          "src/created.txt",

        action:
          "created",

        sha256:
          sha256(
            CREATED_CONTENT
          ),

        previousSha256:
          null,
      },
      {
        path:
          "src/modified.txt",

        action:
          "modified",

        sha256:
          sha256(
            MODIFIED_CONTENT
          ),

        previousSha256:
          sha256(
            "original modified file\n"
          ),
      },
    ],

    dependencies: [
      {
        name:
          DEPENDENCY_NAME,

        version:
          DEPENDENCY_VERSION,

        previousVersion:
          "^1.0.0",
      },
    ],

    environment: [
      {
        name:
          INTRODUCED_ENV,

        introduced:
          true,
      },
      {
        name:
          PREEXISTING_ENV,

        introduced:
          false,
      },
    ],
  };

  await writeJson(
    stateFile,
    {
      schemaVersion:
        1,

      packages: {
        [PACKAGE_ID]:
          receipt,
      },
    }
  );

  await writeJson(
    cacheFile,
    {
      [PACKAGE_ID]: {
        version:
          PACKAGE_VERSION,

        installedAt:
          INSTALLED_AT,

        checksum:
          "legacy-checksum-is-not-authoritative",

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
          PACKAGE_VERSION,
      },
    }
  );

  return {
    root,
    packageJsonFile,
    environmentFile,
    createdFile,
    modifiedFile,
    cacheFile,
    stateFile,
    lockFile,
  };
}

async function updateReceipt(
  project,
  updater
) {
  const state =
    await readJson(
      project.stateFile
    );

  const receipt =
    state.packages[
      PACKAGE_ID
    ];

  updater(
    receipt,
    state
  );

  await writeJson(
    project.stateFile,
    state
  );
}

async function assertIntegrityFailure(
  promise,
  messagePattern
) {
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(
        error?.code,
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED
      );

      assert.match(
        String(
          error?.message ??
            error
        ),
        messagePattern
      );

      return true;
    }
  );
}

async function captureFiles(
  project
) {
  const files = [
    project.packageJsonFile,
    project.environmentFile,
    project.createdFile,
    project.modifiedFile,
    project.cacheFile,
    project.stateFile,
    project.lockFile,
  ];

  const snapshot = {};

  for (const file of files) {
    const information =
      await fs.stat(file);

    snapshot[
      path.relative(
        project.root,
        file
      )
    ] = {
      content:
        (
          await fs.readFile(
            file
          )
        ).toString(
          "base64"
        ),

      size:
        information.size,

      mtimeMs:
        information.mtimeMs,

      mode:
        information.mode,
    };
  }

  return snapshot;
}

test(
  "healthy installed state verifies created and modified ownership",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    const verifier =
      new InstalledStateVerifier();

    await verifier.verify(
      PACKAGE_ID,
      project.root
    );
  }
);

test(
  "cache metadata without an A2 ownership receipt fails closed",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    const state =
      await readJson(
        project.stateFile
      );

    state.packages = {};

    await writeJson(
      project.stateFile,
      state
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /ownership receipt/i
    );
  }
);

test(
  "missing owned file fails verification",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.unlink(
      project.createdFile
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /owned file.*missing/i
    );
  }
);

test(
  "owned file content drift fails SHA-256 verification",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.writeFile(
      project.createdFile,
      "user changed this file\n",
      "utf8"
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /recorded installed digest/i
    );
  }
);

test(
  "owned path through a symbolic-link or junction ancestor fails closed",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    const realDirectory =
      path.join(
        project.root,
        "real-owned"
      );

    const linkedDirectory =
      path.join(
        project.root,
        "linked-owned"
      );

    await fs.mkdir(
      realDirectory
    );

    await fs.writeFile(
      path.join(
        realDirectory,
        "file.txt"
      ),
      CREATED_CONTENT,
      "utf8"
    );

    try {
      await fs.symlink(
        realDirectory,
        linkedDirectory,
        process.platform ===
          "win32"
          ? "junction"
          : "dir"
      );
    }
    catch (error) {
      if (
        error?.code ===
          "EPERM" ||
        error?.code ===
          "EACCES"
      ) {
        t.skip(
          "Host does not permit symbolic-link or junction creation."
        );

        return;
      }

      throw error;
    }

    await updateReceipt(
      project,
      (receipt) => {
        receipt.files = [
          {
            path:
              "linked-owned/file.txt",

            action:
              "created",

            sha256:
              sha256(
                CREATED_CONTENT
              ),

            previousSha256:
              null,
          },
        ];
      }
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /symbolic link|junction|safely resolved|installed-state/i
    );
  }
);

test(
  "non-regular owned path fails closed",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.unlink(
      project.createdFile
    );

    await fs.mkdir(
      project.createdFile
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /regular file|installed-state/i
    );
  }
);

test(
  "owned dependency version drift fails verification",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    const packageJson =
      await readJson(
        project.packageJsonFile
      );

    packageJson.dependencies[
      DEPENDENCY_NAME
    ] = "^3.0.0";

    await writeJson(
      project.packageJsonFile,
      packageJson
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /owned dependency.*recorded installed version/i
    );
  }
);

test(
  "removing a package-introduced environment marker fails verification",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.writeFile(
      project.environmentFile,
      `${PREEXISTING_ENV}=\n`,
      "utf8"
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /introduced environment variable/i
    );
  }
);

test(
  "pre-existing environment ownership does not require the package to claim its presence",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await updateReceipt(
      project,
      (receipt) => {
        receipt.environment = [
          {
            name:
              PREEXISTING_ENV,

            introduced:
              false,
          },
        ];
      }
    );

    await fs.unlink(
      project.environmentFile
    );

    await new InstalledStateVerifier()
      .verify(
        PACKAGE_ID,
        project.root
      );
  }
);

test(
  "cache version disagreement with ownership state fails closed",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    const cache =
      await readJson(
        project.cacheFile
      );

    cache[
      PACKAGE_ID
    ].version =
      "2.0.0";

    await writeJson(
      project.cacheFile,
      cache
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /cache version/i
    );
  }
);

test(
  "missing lock entry fails closed",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await writeJson(
      project.lockFile,
      {
        packages: {},
      }
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /missing from aurora\.lock/i
    );
  }
);

test(
  "lock version disagreement with ownership state fails closed",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await writeJson(
      project.lockFile,
      {
        packages: {
          [PACKAGE_ID]:
            "2.0.0",
        },
      }
    );

    await assertIntegrityFailure(
      new InstalledStateVerifier()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /locked version/i
    );
  }
);

test(
  "installed-state verification is read-only",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    const before =
      await captureFiles(
        project
      );

    await new InstalledStateVerifier()
      .verify(
        PACKAGE_ID,
        project.root
      );

    const after =
      await captureFiles(
        project
      );

    assert.deepEqual(
      after,
      before
    );
  }
);

test(
  "VerifyManager throws instead of returning normally for corrupted installed state",
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.writeFile(
      project.modifiedFile,
      "corrupted\n",
      "utf8"
    );

    await assertIntegrityFailure(
      new VerifyManager()
        .verify(
          PACKAGE_ID,
          project.root
        ),
      /recorded installed digest/i
    );
  }
);

test(
  "RepairManager re-verifies after a no-op repair and cannot report false success",
  {
    concurrency:
      false,
  },
  async (t) => {
    const project =
      await createHealthyProject();

    t.after(
      async () => {
        await fs.rm(
          project.root,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.writeFile(
      project.createdFile,
      "still corrupted\n",
      "utf8"
    );

    const originalInstall =
      PackageWorker
        .prototype
        .install;

    const originalLog =
      console.log;

    let installCalls = 0;

    const logs = [];

    PackageWorker
      .prototype
      .install =
      async function () {
        installCalls += 1;
      };

    console.log =
      (...values) => {
        logs.push(
          values
            .map(
              value =>
                String(value)
            )
            .join(" ")
        );
      };

    t.after(
      () => {
        PackageWorker
          .prototype
          .install =
          originalInstall;

        console.log =
          originalLog;
      }
    );

    await assertIntegrityFailure(
      new RepairManager()
        .repair(
          PACKAGE_ID,
          project.root
        ),
      /recorded installed digest/i
    );

    assert.equal(
      installCalls,
      1
    );

    assert.equal(
      logs.some(
        line =>
          line.includes(
            "Repair completed successfully."
          )
      ),
      false
    );

    assert.equal(
      logs.some(
        line =>
          line.includes(
            "Repairing package..."
          )
      ),
      true
    );
  }
);
