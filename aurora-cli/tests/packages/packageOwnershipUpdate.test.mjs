import test from "node:test";
import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  mergePackageOwnershipReceipts,
} =
  await loadDist(
    "packages/update/packageOwnershipTransition.js"
  );


const {
  PackageUpdateCoordinator,
} =
  await loadDist(
    "packages/update/packageUpdateCoordinator.js"
  );


const {
  UpdatePlanner,
} =
  await loadDist(
    "packages/update/updatePlanner.js"
  );


const {
  UpdateExecutor,
} =
  await loadDist(
    "packages/update/updateExecutor.js"
  );



const {
  InstallerContext,
} =
  await loadDist(
    "packages/installer/installerContext.js"
  );


const {
  PackageWorker,
} =
  await loadDist(
    "packages/installation/packageWorker.js"
  );


const {
  PackageTrustPolicy,
} =
  await loadDist(
    "packages/trust/packageTrustPolicy.js"
  );


const {
  InstalledStateVerifier,
} =
  await loadDist(
    "packages/verify/installedStateVerifier.js"
  );


const {
  WriteLock,
} =
  await loadDist(
    "packages/synchronization/writeLock.js"
  );


const {
  calculateArtifactDigest,
} =
  await loadDist(
    "packages/integrity/packageArtifactVerifier.js"
  );

const PACKAGE_ID =
  "update-target";

const OTHER_PACKAGE =
  "other-package";

const OLD_VERSION =
  "1.0.0";

const NEW_VERSION =
  "2.0.0";

const INSTALLED_AT =
  "2026-08-19T12:00:00.000Z";


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


function otherReceipt() {
  return {
    id:
      OTHER_PACKAGE,

    version:
      "1.0.0",

    publisherId:
      "aurora-tests",

    artifactSha256:
      "c".repeat(64),

    installedAt:
      INSTALLED_AT,

    files: [],
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
  includeOther = false
) {
  const root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "aurora-package-update-"
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

  const receipts =
    includeOther
      ? [
          receipt(
            OLD_VERSION
          ),
          otherReceipt(),
        ]
      : [
          receipt(
            OLD_VERSION
          ),
        ];

  await writeJson(
    stateFile,
    {
      schemaVersion: 1,

      packages:
        Object.fromEntries(
          receipts.map(
            candidate => [
              candidate.id,
              candidate,
            ]
          )
        ),
    }
  );

  await writeJson(
    cacheFile,
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
    )
  );

  await writeJson(
    lockFile,
    {
      packages:
        Object.fromEntries(
          receipts.map(
            candidate => [
              candidate.id,
              candidate.version,
            ]
          )
        ),
    }
  );

  await writeJson(
    path.join(
      root,
      "package.json"
    ),
    {
      name:
        "update-test-project",

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
  "update transition preserves created-file provenance",
  () => {
    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION,
          {
            files: [
              {
                path:
                  "src/a.ts",

                action:
                  "created",

                sha256:
                  sha256("v1"),

                previousSha256:
                  null,
              },
            ],
          }
        ),
        receipt(
          NEW_VERSION,
          {
            files: [
              {
                path:
                  "src/a.ts",

                action:
                  "modified",

                sha256:
                  sha256("v2"),

                previousSha256:
                  sha256("v1"),
              },
            ],
          }
        )
      );

    assert.deepEqual(
      merged.files,
      [
        {
          path:
            "src/a.ts",

          action:
            "created",

          sha256:
            sha256("v2"),

          previousSha256:
            null,
        },
      ]
    );
  }
);


test(
  "update transition preserves original modified-file predecessor",
  () => {
    const original =
      sha256(
        "before-package"
      );

    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION,
          {
            files: [
              {
                path:
                  "src/a.ts",

                action:
                  "modified",

                sha256:
                  sha256("v1"),

                previousSha256:
                  original,
              },
            ],
          }
        ),
        receipt(
          NEW_VERSION,
          {
            files: [
              {
                path:
                  "src/a.ts",

                action:
                  "modified",

                sha256:
                  sha256("v2"),

                previousSha256:
                  sha256("v1"),
              },
            ],
          }
        )
      );

    assert.equal(
      merged.files[0]
        .previousSha256,
      original
    );
  }
);


test(
  "update transition carries untouched file ownership forward",
  () => {
    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION,
          {
            files: [
              {
                path:
                  "src/untouched.ts",

                action:
                  "created",

                sha256:
                  sha256(
                    "unchanged"
                  ),

                previousSha256:
                  null,
              },
            ],
          }
        ),
        receipt(
          NEW_VERSION
        )
      );

    assert.equal(
      merged.files.length,
      1
    );

    assert.equal(
      merged.files[0].path,
      "src/untouched.ts"
    );
  }
);


test(
  "update transition adopts newly owned files",
  () => {
    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION
        ),
        receipt(
          NEW_VERSION,
          {
            files: [
              {
                path:
                  "src/new.ts",

                action:
                  "created",

                sha256:
                  sha256("new"),

                previousSha256:
                  null,
              },
            ],
          }
        )
      );

    assert.equal(
      merged.files[0].path,
      "src/new.ts"
    );
  }
);


test(
  "update transition preserves original dependency predecessor",
  () => {
    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION,
          {
            dependencies: [
              {
                name:
                  "owned-dep",

                version:
                  "^2.0.0",

                previousVersion:
                  "^1.0.0",
              },
            ],
          }
        ),
        receipt(
          NEW_VERSION,
          {
            dependencies: [
              {
                name:
                  "owned-dep",

                version:
                  "^3.0.0",

                previousVersion:
                  "^2.0.0",
              },
            ],
          }
        )
      );

    assert.equal(
      merged.dependencies[0]
        .previousVersion,
      "^1.0.0"
    );

    assert.equal(
      merged.dependencies[0]
        .version,
      "^3.0.0"
    );
  }
);


test(
  "update transition keeps environment introduction provenance sticky",
  () => {
    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION,
          {
            environment: [
              {
                name:
                  "AURORA_UPDATE_TEST",

                introduced:
                  true,
              },
            ],
          }
        ),
        receipt(
          NEW_VERSION,
          {
            environment: [
              {
                name:
                  "AURORA_UPDATE_TEST",

                introduced:
                  false,
              },
            ],
          }
        )
      );

    assert.equal(
      merged.environment[0]
        .introduced,
      true
    );
  }
);


test(
  "update transition can establish later environment introduction",
  () => {
    const merged =
      mergePackageOwnershipReceipts(
        receipt(
          OLD_VERSION,
          {
            environment: [
              {
                name:
                  "AURORA_UPDATE_TEST",

                introduced:
                  false,
              },
            ],
          }
        ),
        receipt(
          NEW_VERSION,
          {
            environment: [
              {
                name:
                  "AURORA_UPDATE_TEST",

                introduced:
                  true,
              },
            ],
          }
        )
      );

    assert.equal(
      merged.environment[0]
        .introduced,
      true
    );
  }
);


test(
  "update transition refuses publisher changes",
  () => {
    assert.throws(
      () =>
        mergePackageOwnershipReceipts(
          receipt(
            OLD_VERSION
          ),
          receipt(
            NEW_VERSION,
            {
              publisherId:
                "different-publisher",
            }
          )
        ),
      /changed publisher/u
    );
  }
);


test(
  "update planner treats equal version as a no-op",
  () => {
    const planner =
      new UpdatePlanner();

    assert.deepEqual(
      planner.createPlan(
        PACKAGE_ID,
        "1.2.3",
        "1.2.3"
      ),
      []
    );
  }
);


test(
  "update planner permits strictly newer canonical semver",
  () => {
    const planner =
      new UpdatePlanner();

    assert.deepEqual(
      planner.createPlan(
        PACKAGE_ID,
        "1.2.3",
        "1.3.0"
      ),
      [
        {
          package:
            PACKAGE_ID,

          currentVersion:
            "1.2.3",

          targetVersion:
            "1.3.0",
        },
      ]
    );
  }
);


test(
  "update planner rejects downgrade targets",
  () => {
    const planner =
      new UpdatePlanner();

    assert.throws(
      () =>
        planner.createPlan(
          PACKAGE_ID,
          "2.0.0",
          "1.9.9"
        ),
      /cannot downgrade/u
    );
  }
);


test(
  "UpdateExecutor binds PackageWorker to update mode and exact target",
  async () => {
    let observed;

    const fakeWorker = {
      async install(
        packageId,
        context,
        options
      ) {
        observed = {
          packageId,
          context,
          options,
        };

        return {
          version:
            NEW_VERSION,

          checksum:
            "d".repeat(64),

          receipt:
            receipt(
              NEW_VERSION
            ),
        };
      },
    };

    const executor =
      new UpdateExecutor(
        fakeWorker
      );

    const context =
      {};

    await executor.execute(
      PACKAGE_ID,
      NEW_VERSION,
      context
    );

    assert.deepEqual(
      observed.options,
      {
        mode:
          "update",

        expectedVersion:
          NEW_VERSION,
      }
    );
  }
);


test(
  "UpdateExecutor fails closed when worker returns no update receipt",
  async () => {
    const executor =
      new UpdateExecutor({
        async install() {
          return undefined;
        },
      });

    await assert.rejects(
      executor.execute(
        PACKAGE_ID,
        NEW_VERSION,
        {}
      ),
      /returned no ownership receipt/u
    );
  }
);


test(
  "coordinator rejects non-newer execution before lock acquisition",
  async () => {
    let acquired =
      false;

    const coordinator =
      new PackageUpdateCoordinator(
        {
          async execute() {
            throw new Error(
              "must not execute"
            );
          },
        },
        {
          async verify() {},

          async verifyReceipt() {},
        },
        {
          async acquire() {
            acquired =
              true;
          },

          release() {},
        }
      );

    await assert.rejects(
      coordinator.execute(
        PACKAGE_ID,
        "unused",
        OLD_VERSION,
        OLD_VERSION
      ),
      /strictly newer/u
    );

    assert.equal(
      acquired,
      false
    );
  }
);


test(
  "coordinator updates state cache and lock and verifies remaining packages before final target",
  async () => {
    const fixture =
      await createProject(
        true
      );

    const calls =
      [];

    const verifier = {
      async verify(
        packageId
      ) {
        calls.push(
          packageId
        );
      },

      async verifyReceipt(
        packageId
      ) {
        calls.push(
          packageId
        );
      },
    };

    const lifecycleLock = {
      acquired:
        0,

      released:
        0,

      async acquire() {
        this.acquired +=
          1;
      },

      release() {
        this.released +=
          1;
      },
    };

    const executor = {
      async execute(
        packageId,
        targetVersion,
        context
      ) {
        await context.createFile(
          "src/updated.txt",
          "updated\n"
        );

        return {
          version:
            targetVersion,

          checksum:
            "e".repeat(64),

          receipt:
            receipt(
              targetVersion,
              {
                files: [
                  {
                    path:
                      "src/updated.txt",

                    action:
                      "created",

                    sha256:
                      sha256(
                        "updated\n"
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

    try {
      const coordinator =
        new PackageUpdateCoordinator(
          executor,
          verifier,
          lifecycleLock
        );

      await coordinator.execute(
        PACKAGE_ID,
        fixture.root,
        OLD_VERSION,
        NEW_VERSION
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

      assert.deepEqual(
        calls,
        [
          PACKAGE_ID,
          PACKAGE_ID,
          OTHER_PACKAGE,
          PACKAGE_ID,
        ]
      );

      assert.equal(
        lifecycleLock.acquired,
        1
      );

      assert.equal(
        lifecycleLock.released,
        1
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
  "remaining-package verification failure rolls back project before target metadata commit",
  async () => {
    const fixture =
      await createProject(
        true
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

    const verifier = {
      async verify(
        packageId
      ) {
        if (
          packageId ===
            OTHER_PACKAGE
        ) {
          throw new Error(
            "shared ownership conflict"
          );
        }
      },

      async verifyReceipt(
        packageId
      ) {
        await this.verify(
          packageId
        );
      },
    };

    const executor = {
      async execute(
        packageId,
        targetVersion,
        context
      ) {
        await context.createFile(
          "src/conflict.txt",
          "temporary\n"
        );

        return {
          version:
            targetVersion,

          checksum:
            "f".repeat(64),

          receipt:
            receipt(
              targetVersion,
              {
                files: [
                  {
                    path:
                      "src/conflict.txt",

                    action:
                      "created",

                    sha256:
                      sha256(
                        "temporary\n"
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

    try {
      const coordinator =
        new PackageUpdateCoordinator(
          executor,
          verifier,
          {
            async acquire() {},

            release() {},
          }
        );

      await assert.rejects(
        coordinator.execute(
          PACKAGE_ID,
          fixture.root,
          OLD_VERSION,
          NEW_VERSION
        ),
        /shared ownership conflict/u
      );

      await assert.rejects(
        fs.access(
          path.join(
            fixture.root,
            "src",
            "conflict.txt"
          )
        )
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
    }
    finally {
      await cleanup(
        fixture
      );
    }
  }
);


test(
  "final target verification failure rolls back project and all lifecycle metadata",
  async () => {
    const fixture =
      await createProject();

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

    let targetChecks =
      0;

    const verifier = {
      async verify(
        packageId
      ) {
        if (
          packageId ===
            PACKAGE_ID
        ) {
          targetChecks +=
            1;

          if (
            targetChecks === 3
          ) {
            throw new Error(
              "final verification failure"
            );
          }
        }
      },

      async verifyReceipt(
        packageId
      ) {
        await this.verify(
          packageId
        );
      },
    };

    const executor = {
      async execute(
        packageId,
        targetVersion,
        context
      ) {
        await context.createFile(
          "src/rollback.txt",
          "temporary\n"
        );

        return {
          version:
            targetVersion,

          checksum:
            "f".repeat(64),

          receipt:
            receipt(
              targetVersion,
              {
                files: [
                  {
                    path:
                      "src/rollback.txt",

                    action:
                      "created",

                    sha256:
                      sha256(
                        "temporary\n"
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

    try {
      const coordinator =
        new PackageUpdateCoordinator(
          executor,
          verifier,
          {
            async acquire() {},

            release() {},
          }
        );

      await assert.rejects(
        coordinator.execute(
          PACKAGE_ID,
          fixture.root,
          OLD_VERSION,
          NEW_VERSION
        ),
        /final verification failure/u
      );

      await assert.rejects(
        fs.access(
          path.join(
            fixture.root,
            "src",
            "rollback.txt"
          )
        )
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
    }
    finally {
      await cleanup(
        fixture
      );
    }
  }
);
async function pathExists(
  file
) {
  try {
    await fs.access(
      file
    );

    return true;
  }
  catch (error) {
    if (
      error?.code ===
        "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}


async function createExecutablePackage(
  id,
  version,
  source
) {
  const packageRoot =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "aurora-update-worker-package-"
      )
    );

  const packageDirectory =
    path.join(
      packageRoot,
      id
    );

  await fs.mkdir(
    packageDirectory,
    {
      recursive: true,
    }
  );

  const installerFile =
    path.join(
      packageDirectory,
      "install.js"
    );

  await fs.writeFile(
    installerFile,
    source,
    "utf8"
  );

  const files = [
    {
      path:
        "install.js",

      role:
        "installer",

      digest:
        sha256(source),
    },
  ];

  const manifest = {
    manifestVersion: 1,
    kind: "package",

    id,
    name: id,
    version,

    description:
      `Update acceptance package ${id}.`,

    category:
      "testing",

    tags: [
      "test",
    ],

    frameworks: [
      "agnostic",
    ],

    compatibility: {
      aurora:
        ">=0.1.0 <1.0.0",

      node:
        ">=22.0.0",
    },

    publisher: {
      id:
        "aurora-tests",

      name:
        "Aurora Tests",

      url:
        "https://example.com/aurora-tests",
    },

    artifact: {
      algorithm:
        "sha256",

      digest:
        calculateArtifactDigest(
          files
        ),
    },

    provenance: {
      type:
        "source",

      url:
        "https://example.com/aurora-tests/source",

      reference:
        `${id}@${version}`,
    },

    dependencies: [],
    conflicts: [],

    capabilities: [
      "package.code.execute",
      "project.files.write",
    ],

    files,
    migrations: [],
    environment: [],

    platforms: {
      os: [
        "any",
      ],

      architecture: [
        "any",
      ],
    },

    lifecycle: {
      deprecated:
        false,

      revoked:
        false,
    },

    links: {},
  };

  await fs.writeFile(
    path.join(
      packageDirectory,
      "manifest.json"
    ),
    `${JSON.stringify(
      manifest,
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    packageRoot,
    packageDirectory,
    installerFile,
    manifest,
  };
}


function createRealUpdateWorker(
  packageRoot
) {
  return new PackageWorker(
    packageRoot,
    {
      allowedCapabilities: [
        "package.code.execute",
        "project.files.write",
      ],
    },
    new PackageTrustPolicy({
      requireSignatures:
        false,
    })
  );
}


test(
  "successful coordinator commit discards rollback snapshots",
  async () => {
    const fixture =
      await createProject();

    let capturedContext;

    const executor = {
      async execute(
        packageId,
        targetVersion,
        context
      ) {
        capturedContext =
          context;

        await context.createFile(
          "src/committed.txt",
          "committed\n"
        );

        return {
          version:
            targetVersion,

          checksum:
            "1".repeat(64),

          receipt:
            receipt(
              targetVersion,
              {
                files: [
                  {
                    path:
                      "src/committed.txt",

                    action:
                      "created",

                    sha256:
                      sha256(
                        "committed\n"
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

    const verifier = {
      async verify() {},

      async verifyReceipt() {},
    };

    try {
      const coordinator =
        new PackageUpdateCoordinator(
          executor,
          verifier,
          {
            async acquire() {},

            release() {},
          }
        );

      await coordinator.execute(
        PACKAGE_ID,
        fixture.root,
        OLD_VERSION,
        NEW_VERSION
      );

      assert.ok(
        capturedContext
      );

      /*
       * A rollback after a successful coordinator
       * return must now be a no-op because commit()
       * cleared the transaction's rollback state.
       */
      await capturedContext
        .transaction
        .rollback();

      assert.equal(
        await fs.readFile(
          path.join(
            fixture.root,
            "src",
            "committed.txt"
          ),
          "utf8"
        ),
        "committed\n"
      );

      const state =
        JSON.parse(
          await fs.readFile(
            fixture.stateFile,
            "utf8"
          )
        );

      assert.equal(
        state.packages[
          PACKAGE_ID
        ].version,
        NEW_VERSION
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
  "real PackageWorker update mode executes despite an existing installed cache entry",
  {
    timeout:
      5000,
  },
  async () => {
    const fixture =
      await createProject();

    const packageArtifact =
      await createExecutablePackage(
        PACKAGE_ID,
        NEW_VERSION,
        `
export async function install(context) {
  await context.createFile(
    "real-update.txt",
    "updated\\n"
  );
}
`
      );

    try {
      const worker =
        createRealUpdateWorker(
          packageArtifact
            .packageRoot
        );

      const context =
        new InstallerContext(
          fixture.root
        );

      const result =
        await worker.install(
          PACKAGE_ID,
          context,
          {
            mode:
              "update",

            expectedVersion:
              NEW_VERSION,
          }
        );

      assert.ok(
        result
      );

      assert.equal(
        result.version,
        NEW_VERSION
      );

      assert.equal(
        await fs.readFile(
          path.join(
            fixture.root,
            "real-update.txt"
          ),
          "utf8"
        ),
        "updated\n"
      );

      assert.ok(
        result.receipt.files
          .some(
            file =>
              file.path ===
                "real-update.txt"
          )
      );

      /*
       * Update mode must defer lifecycle metadata
       * instead of performing the normal nested
       * cache/state/lock writes itself.
       */
      const cache =
        JSON.parse(
          await fs.readFile(
            fixture.cacheFile,
            "utf8"
          )
        );

      assert.equal(
        cache[
          PACKAGE_ID
        ].version,
        OLD_VERSION
      );
    }
    finally {
      await cleanup(
        fixture
      );

      await fs.rm(
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "real PackageWorker rejects mismatched expected update version before installer mutation",
  {
    timeout:
      5000,
  },
  async () => {
    const fixture =
      await createProject();

    const packageArtifact =
      await createExecutablePackage(
        PACKAGE_ID,
        NEW_VERSION,
        `
export async function install(context) {
  await context.createFile(
    "wrong-target-ran.txt",
    "must not exist\\n"
  );
}
`
      );

    try {
      const worker =
        createRealUpdateWorker(
          packageArtifact
            .packageRoot
        );

      const context =
        new InstallerContext(
          fixture.root
        );

      await assert.rejects(
        worker.install(
          PACKAGE_ID,
          context,
          {
            mode:
              "update",

            expectedVersion:
              "2.0.1",
          }
        ),
        error => {
          assert.equal(
            error?.code,
            "PACKAGE_INTEGRITY_FAILED"
          );

          assert.match(
            String(
              error?.message
            ),
            /requires '2\.0\.1'/u
          );

          return true;
        }
      );

      assert.equal(
        await pathExists(
          path.join(
            fixture.root,
            "wrong-target-ran.txt"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        fixture
      );

      await fs.rm(
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);


test(
  "real InstalledStateVerifier rejects owned-file drift before update executor mutation",
  async () => {
    const fixture =
      await createProject();

    const driftFile =
      path.join(
        fixture.root,
        "src",
        "drift.txt"
      );

    await fs.mkdir(
      path.dirname(
        driftFile
      ),
      {
        recursive: true,
      }
    );

    await fs.writeFile(
      driftFile,
      "tampered\n",
      "utf8"
    );

    const state =
      JSON.parse(
        await fs.readFile(
          fixture.stateFile,
          "utf8"
        )
      );

    state.packages[
      PACKAGE_ID
    ].files = [
      {
        path:
          "src/drift.txt",

        action:
          "created",

        sha256:
          sha256(
            "expected\n"
          ),

        previousSha256:
          null,
      },
    ];

    await writeJson(
      fixture.stateFile,
      state
    );

    let executed =
      false;

    let lockAcquired =
      false;

    const coordinator =
      new PackageUpdateCoordinator(
        {
          async execute() {
            executed =
              true;

            throw new Error(
              "executor must not run"
            );
          },
        },
        new InstalledStateVerifier(),
        {
          async acquire() {
            lockAcquired =
              true;
          },

          release() {},
        }
      );

    try {
      await assert.rejects(
        coordinator.execute(
          PACKAGE_ID,
          fixture.root,
          OLD_VERSION,
          NEW_VERSION
        ),
        error => {
          assert.equal(
            error?.code,
            "PACKAGE_INTEGRITY_FAILED"
          );

          assert.match(
            String(
              error?.message
            ),
            /does not match its recorded installed digest/u
          );

          return true;
        }
      );

      assert.equal(
        executed,
        false
      );

      /*
       * The ordinary verifier gate occurs before
       * the coordinator acquires mutation authority.
       */
      assert.equal(
        lockAcquired,
        false
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
  "real process-wide WriteLock serializes concurrent update coordinators without verifier deadlock",
  {
    timeout:
      5000,
  },
  async () => {
    const first =
      await createProject();

    const second =
      await createProject();

    let active =
      0;

    let maxActive =
      0;

    let signalFirstEntered;

    const firstEntered =
      new Promise(
        resolve => {
          signalFirstEntered =
            resolve;
        }
      );

    let entries =
      0;

    const executor = {
      async execute(
        packageId,
        targetVersion
      ) {
        entries +=
          1;

        active +=
          1;

        maxActive =
          Math.max(
            maxActive,
            active
          );

        if (
          entries === 1
        ) {
          signalFirstEntered();
        }

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              50
            )
        );

        active -=
          1;

        return {
          version:
            targetVersion,

          checksum:
            "2".repeat(64),

          receipt:
            receipt(
              targetVersion
            ),
        };
      },
    };

    try {
      const verifier =
        new InstalledStateVerifier();

      const firstCoordinator =
        new PackageUpdateCoordinator(
          executor,
          verifier,
          new WriteLock()
        );

      const secondCoordinator =
        new PackageUpdateCoordinator(
          executor,
          verifier,
          new WriteLock()
        );

      const firstRun =
        firstCoordinator.execute(
          PACKAGE_ID,
          first.root,
          OLD_VERSION,
          NEW_VERSION
        );

      await firstEntered;

      const secondRun =
        secondCoordinator.execute(
          PACKAGE_ID,
          second.root,
          OLD_VERSION,
          NEW_VERSION
        );

      await Promise.all([
        firstRun,
        secondRun,
      ]);

      assert.equal(
        entries,
        2
      );

      assert.equal(
        maxActive,
        1
      );

      const firstState =
        JSON.parse(
          await fs.readFile(
            first.stateFile,
            "utf8"
          )
        );

      const secondState =
        JSON.parse(
          await fs.readFile(
            second.stateFile,
            "utf8"
          )
        );

      assert.equal(
        firstState.packages[
          PACKAGE_ID
        ].version,
        NEW_VERSION
      );

      assert.equal(
        secondState.packages[
          PACKAGE_ID
        ].version,
        NEW_VERSION
      );
    }
    finally {
      await cleanup(
        first
      );

      await cleanup(
        second
      );
    }
  }
);
