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
  FileTransaction,
} =
  await loadDist(
    "core/fileTransaction.js"
  );


const {
  CacheManager,
} =
  await loadDist(
    "packages/cache/cacheManager.js"
  );


const {
  WriteLock,
} =
  await loadDist(
    "packages/synchronization/writeLock.js"
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
  PackageUninstallMetadataCoordinator,
} =
  await loadDist(
    "packages/uninstall/packageUninstallMetadataCoordinator.js"
  );


const {
  UninstallManager,
} =
  await loadDist(
    "packages/uninstall/uninstallManager.js"
  );


const TARGET =
  "target-package";

const OTHER =
  "other-package";

const VERSION =
  "1.0.0";

const INSTALLED_AT =
  "2026-08-19T10:00:00.000Z";


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


function packageState(
  receipts
) {
  return {
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


async function exists(
  file
) {
  try {
    await fs.lstat(
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


async function temporaryProject(
  prefix =
    "aurora-package-uninstall-"
) {
  return fs.mkdtemp(
    path.join(
      os.tmpdir(),
      prefix
    )
  );
}


async function createProject(
  receipts,
  options = {}
) {
  const root =
    await temporaryProject();

  const auroraDirectory =
    path.join(
      root,
      ".aurora"
    );

  const stateFile =
    path.join(
      auroraDirectory,
      "package-state.json"
    );

  const cacheFile =
    path.join(
      auroraDirectory,
      "cache.json"
    );

  const lockFile =
    path.join(
      root,
      "aurora.lock"
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

  await fs.mkdir(
    auroraDirectory,
    {
      recursive: true,
    }
  );

  await writeJson(
    packageJsonFile,
    {
      name:
        "aurora-uninstall-fixture",

      version:
        "1.0.0",

      dependencies:
        options.dependencies ??
        {},
    }
  );

  await fs.writeFile(
    environmentFile,
    options.environment ??
      "",
    "utf8"
  );

  for (
    const [
      relativePath,
      content,
    ]
    of Object.entries(
      options.files ??
      {}
    )
  ) {
    const file =
      path.join(
        root,
        ...relativePath.split("/")
      );

    await fs.mkdir(
      path.dirname(file),
      {
        recursive: true,
      }
    );

    await fs.writeFile(
      file,
      content,
      "utf8"
    );
  }

  const state =
    packageState(
      receipts
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

  const lock =
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
    };

  await writeJson(
    stateFile,
    state
  );

  await writeJson(
    cacheFile,
    cache
  );

  await writeJson(
    lockFile,
    lock
  );

  return {
    root,
    state,
    stateFile,
    cacheFile,
    lockFile,
    packageJsonFile,
    environmentFile,
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


function ownership(
  fixture
) {
  const transaction =
    new FileTransaction(
      "package uninstall test",
      fixture.root
    );

  return {
    transaction,

    uninstaller:
      new PackageOwnershipUninstaller(
        fixture.root,
        transaction
      ),
  };
}


test(
  "uninstall removes a sole-owned created file and only target metadata",
  async () => {
    const content =
      "package-created\n";

    const target =
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
                sha256(content),

              previousSha256:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          files: {
            "owned.txt":
              content,
          },
        }
      );

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
        );

      assert.equal(
        await exists(
          path.join(
            fixture.root,
            "owned.txt"
          )
        ),
        false
      );

      assert.deepEqual(
        (
          await readJson(
            fixture.stateFile
          )
        ).packages,
        {}
      );

      assert.deepEqual(
        await readJson(
          fixture.cacheFile
        ),
        {}
      );

      assert.deepEqual(
        (
          await readJson(
            fixture.lockFile
          )
        ).packages,
        {}
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
  "installed-state corruption is rejected before uninstall mutates metadata",
  async () => {
    const original =
      "trusted\n";

    const target =
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
                sha256(original),

              previousSha256:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          files: {
            "owned.txt":
              original,
          },
        }
      );

    try {
      await fs.writeFile(
        path.join(
          fixture.root,
          "owned.txt"
        ),
        "tampered\n",
        "utf8"
      );

      const beforeState =
        await fs.readFile(
          fixture.stateFile,
          "utf8"
        );

      const beforeCache =
        await fs.readFile(
          fixture.cacheFile,
          "utf8"
        );

      const beforeLock =
        await fs.readFile(
          fixture.lockFile,
          "utf8"
        );

      await assert.rejects(
        () =>
          new UninstallManager()
            .uninstall(
              TARGET,
              fixture.root
            )
      );

      assert.equal(
        await fs.readFile(
          fixture.stateFile,
          "utf8"
        ),
        beforeState
      );

      assert.equal(
        await fs.readFile(
          fixture.cacheFile,
          "utf8"
        ),
        beforeCache
      );

      assert.equal(
        await fs.readFile(
          fixture.lockFile,
          "utf8"
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
  "sole-owned modified file fails closed because previous bytes are unavailable",
  async () => {
    const before =
      "before\n";

    const current =
      "after\n";

    const target =
      receipt(
        TARGET,
        {
          files: [
            {
              path:
                "modified.txt",

              action:
                "modified",

              sha256:
                sha256(current),

              previousSha256:
                sha256(before),
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          files: {
            "modified.txt":
              current,
          },
        }
      );

    try {
      await assert.rejects(
        () =>
          new UninstallManager()
            .uninstall(
              TARGET,
              fixture.root
            ),
        /previous bytes/u
      );

      assert.equal(
        await fs.readFile(
          path.join(
            fixture.root,
            "modified.txt"
          ),
          "utf8"
        ),
        current
      );

      assert.ok(
        (
          await readJson(
            fixture.stateFile
          )
        ).packages[
          TARGET
        ]
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
  "compatible shared created file is preserved when remaining owner retains creation provenance",
  async () => {
    const content =
      "shared\n";

    const target =
      receipt(
        TARGET,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(content),

              previousSha256:
                null,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(content),

              previousSha256:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          files: {
            "shared.txt":
              content,
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      assert.equal(
        plan.files.length,
        1
      );

      assert.equal(
        plan.files[0].remove,
        false
      );

      await uninstaller.apply(
        plan
      );

      assert.equal(
        await fs.readFile(
          path.join(
            fixture.root,
            "shared.txt"
          ),
          "utf8"
        ),
        content
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
  "conflicting shared file ownership fails before mutation",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(
                  "one\n"
                ),

              previousSha256:
                null,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(
                  "two\n"
                ),

              previousSha256:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          files: {
            "shared.txt":
              "one\n",
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      assert.throws(
        () =>
          uninstaller.createPlan(
            target,
            fixture.state
          ),
        /conflicting remaining ownership/u
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
  "shared modified ownership may be relinquished when compatible creator remains",
  async () => {
    const original =
      "original\n";

    const current =
      "shared-current\n";

    const target =
      receipt(
        TARGET,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "modified",

              sha256:
                sha256(current),

              previousSha256:
                sha256(original),
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(current),

              previousSha256:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          files: {
            "shared.txt":
              current,
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      assert.equal(
        plan.files[0].remove,
        false
      );

      await uninstaller.apply(
        plan
      );

      assert.equal(
        await fs.readFile(
          path.join(
            fixture.root,
            "shared.txt"
          ),
          "utf8"
        ),
        current
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
  "created file cannot lose its only creation provenance",
  async () => {
    const previous =
      "previous\n";

    const current =
      "current\n";

    const target =
      receipt(
        TARGET,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(current),

              previousSha256:
                null,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "modified",

              sha256:
                sha256(current),

              previousSha256:
                sha256(previous),
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          files: {
            "shared.txt":
              current,
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      assert.throws(
        () =>
          uninstaller.createPlan(
            target,
            fixture.state
          ),
        /lose its creation provenance/u
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
  "introduced dependency is removed when target is sole owner",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          dependencies: [
            {
              name:
                "owned-dep",

              version:
                "^2.0.0",

              previousVersion:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          dependencies: {
            "owned-dep":
              "^2.0.0",
          },
        }
      );

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
        );

      assert.deepEqual(
        (
          await readJson(
            fixture.packageJsonFile
          )
        ).dependencies,
        {}
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
  "changed dependency restores exact previous version",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          dependencies: [
            {
              name:
                "owned-dep",

              version:
                "^2.0.0",

              previousVersion:
                "^1.5.0",
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          dependencies: {
            "owned-dep":
              "^2.0.0",
          },
        }
      );

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
        );

      assert.equal(
        (
          await readJson(
            fixture.packageJsonFile
          )
        ).dependencies[
          "owned-dep"
        ],
        "^1.5.0"
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
  "later dependency observer may be removed while original transition owner remains",
  async () => {
    const originalOwner =
      receipt(
        OTHER,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                null,
            },
          ],
        }
      );

    const target =
      receipt(
        TARGET,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                "2.0.0",
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          originalOwner,
        ],
        {
          dependencies: {
            "shared-dep":
              "2.0.0",
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      assert.equal(
        plan.dependencies.length,
        1
      );

      assert.equal(
        plan.dependencies[0]
          .replacementVersion,
        undefined
      );

      await uninstaller.apply(
        plan
      );

      assert.equal(
        (
          await readJson(
            fixture.packageJsonFile
          )
        ).dependencies[
          "shared-dep"
        ],
        "2.0.0"
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
  "dependency transition owner cannot lose restoration provenance",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                null,
            },
          ],
        }
      );

    const observer =
      receipt(
        OTHER,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                "2.0.0",
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          observer,
        ],
        {
          dependencies: {
            "shared-dep":
              "2.0.0",
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      assert.throws(
        () =>
          uninstaller.createPlan(
            target,
            fixture.state
          ),
        /lose its restoration provenance/u
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
  "conflicting shared dependency versions fail closed",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                null,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "3.0.0",

              previousVersion:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          dependencies: {
            "shared-dep":
              "2.0.0",
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      assert.throws(
        () =>
          uninstaller.createPlan(
            target,
            fixture.state
          ),
        /conflicting remaining ownership/u
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
  "introduced false environment ownership is never removed",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          environment: [
            {
              name:
                "PREEXISTING",

              introduced:
                false,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          environment:
            "PREEXISTING=user\n",
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      assert.deepEqual(
        plan.environment,
        []
      );

      await uninstaller.apply(
        plan
      );

      assert.equal(
        await fs.readFile(
          fixture.environmentFile,
          "utf8"
        ),
        "PREEXISTING=user\n"
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
  "sole-owned introduced empty environment marker is removed exactly",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          environment: [
            {
              name:
                "OWNED_VARIABLE",

              introduced:
                true,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          environment:
            "KEEP=1\nOWNED_VARIABLE=\nNEXT=2\n",
        }
      );

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
        );

      assert.equal(
        await fs.readFile(
          fixture.environmentFile,
          "utf8"
        ),
        "KEEP=1\nNEXT=2\n"
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
  "shared environment marker is preserved when remaining owner retains introduction provenance",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          environment: [
            {
              name:
                "SHARED_ENV",

              introduced:
                true,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          environment: [
            {
              name:
                "SHARED_ENV",

              introduced:
                true,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          environment:
            "SHARED_ENV=\n",
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      assert.equal(
        plan.environment[0].remove,
        false
      );

      await uninstaller.apply(
        plan
      );

      assert.equal(
        await fs.readFile(
          fixture.environmentFile,
          "utf8"
        ),
        "SHARED_ENV=\n"
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
  "introduced environment owner cannot leave only non-introducing ownership behind",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          environment: [
            {
              name:
                "SHARED_ENV",

              introduced:
                true,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          environment: [
            {
              name:
                "SHARED_ENV",

              introduced:
                false,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          environment:
            "SHARED_ENV=\n",
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      assert.throws(
        () =>
          uninstaller.createPlan(
            target,
            fixture.state
          ),
        /lose its introduction provenance/u
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
  "user-populated introduced environment value is never silently deleted",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          environment: [
            {
              name:
                "OWNED_VARIABLE",

              introduced:
                true,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          environment:
            "OWNED_VARIABLE=user-value\n",
        }
      );

    try {
      const beforeState =
        await fs.readFile(
          fixture.stateFile,
          "utf8"
        );

      const beforeCache =
        await fs.readFile(
          fixture.cacheFile,
          "utf8"
        );

      const beforeLock =
        await fs.readFile(
          fixture.lockFile,
          "utf8"
        );

      await assert.rejects(
        () =>
          new UninstallManager()
            .uninstall(
              TARGET,
              fixture.root
            ),
        /contains a value/u
      );

      assert.equal(
        await fs.readFile(
          fixture.environmentFile,
          "utf8"
        ),
        "OWNED_VARIABLE=user-value\n"
      );

      assert.equal(
        await fs.readFile(
          fixture.stateFile,
          "utf8"
        ),
        beforeState
      );

      assert.equal(
        await fs.readFile(
          fixture.cacheFile,
          "utf8"
        ),
        beforeCache
      );

      assert.equal(
        await fs.readFile(
          fixture.lockFile,
          "utf8"
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
  "UninstallManager does not remove a package when an installed dependent blocks it",
  async () => {
    const target =
      receipt(
        TARGET
      );

    const fixture =
      await createProject(
        [
          target,
        ]
      );

    const originalFindDependents =
      DependencyInspector
        .prototype
        .findDependents;

    DependencyInspector
      .prototype
      .findDependents =
        async () => [
          "dependent-package",
        ];

    try {
      await new UninstallManager()
        .uninstall(
          TARGET,
          fixture.root
        );

      assert.ok(
        (
          await readJson(
            fixture.stateFile
          )
        ).packages[
          TARGET
        ]
      );

      assert.ok(
        (
          await readJson(
            fixture.cacheFile
          )
        )[
          TARGET
        ]
      );

      assert.equal(
        (
          await readJson(
            fixture.lockFile
          )
        ).packages[
          TARGET
        ],
        VERSION
      );
    }
    finally {
      DependencyInspector
        .prototype
        .findDependents =
          originalFindDependents;

      await cleanup(
        fixture
      );
    }
  }
);


test(
  "DependencyInspector considers only installed package ids",
  async () => {
    const inspector =
      new DependencyInspector(
        os.tmpdir()
      );

    let calls = 0;

    inspector.registry = {
      async getPackage() {
        calls += 1;

        return {
          dependencies: [
            {
              id:
                TARGET,
            },
          ],
        };
      },
    };

    const dependents =
      await inspector
        .findDependents(
          TARGET,
          [
            TARGET,
          ]
        );

    assert.deepEqual(
      dependents,
      []
    );

    assert.equal(
      calls,
      0
    );
  }
);


test(
  "DependencyInspector reports an installed dependent",
  async () => {
    const inspector =
      new DependencyInspector(
        os.tmpdir()
      );

    inspector.registry = {
      async getPackage(
        packageId
      ) {
        assert.equal(
          packageId,
          "dependent-package"
        );

        return {
          dependencies: [
            {
              id:
                TARGET,
            },
          ],
        };
      },
    };

    assert.deepEqual(
      await inspector
        .findDependents(
          TARGET,
          [
            TARGET,
            "dependent-package",
          ]
        ),
      [
        "dependent-package",
      ]
    );
  }
);


test(
  "DependencyInspector fails closed when an installed manifest is unavailable",
  async () => {
    const inspector =
      new DependencyInspector(
        os.tmpdir()
      );

    inspector.registry = {
      async getPackage() {
        throw new Error(
          "missing manifest"
        );
      },
    };

    await assert.rejects(
      () =>
        inspector.findDependents(
          TARGET,
          [
            TARGET,
            "missing-package",
          ]
        ),
      /manifest is unavailable/u
    );
  }
);


test(
  "metadata coordinator removes only target entries and preserves unrelated metadata",
  async () => {
    const target =
      receipt(
        TARGET
      );

    const other =
      receipt(
        OTHER
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ]
      );

    const transaction =
      new FileTransaction(
        "metadata uninstall",
        fixture.root
      );

    const coordinator =
      new PackageUninstallMetadataCoordinator(
        fixture.root
      );

    try {
      await coordinator.execute({
        packageId:
          TARGET,

        expectedState:
          fixture.state,

        expectedReceipt:
          target,

        transaction,

        mutateProject:
          async () => {},
      });

      const state =
        await readJson(
          fixture.stateFile
        );

      const cache =
        await readJson(
          fixture.cacheFile
        );

      const lock =
        await readJson(
          fixture.lockFile
        );

      assert.equal(
        state.packages[
          TARGET
        ],
        undefined
      );

      assert.equal(
        cache[
          TARGET
        ],
        undefined
      );

      assert.equal(
        lock.packages[
          TARGET
        ],
        undefined
      );

      assert.deepEqual(
        state.packages[
          OTHER
        ],
        other
      );

      assert.ok(
        cache[
          OTHER
        ]
      );

      assert.equal(
        lock.packages[
          OTHER
        ],
        VERSION
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
  "metadata write failure rolls back project and metadata mutations",
  async () => {
    const target =
      receipt(
        TARGET
      );

    const fixture =
      await createProject(
        [
          target,
        ],
        {
          files: {
            "project.txt":
              "before\n",
          },
        }
      );

    const projectFile =
      path.join(
        fixture.root,
        "project.txt"
      );

    const beforeProject =
      await fs.readFile(
        projectFile,
        "utf8"
      );

    const beforeState =
      await fs.readFile(
        fixture.stateFile,
        "utf8"
      );

    const beforeCache =
      await fs.readFile(
        fixture.cacheFile,
        "utf8"
      );

    const beforeLock =
      await fs.readFile(
        fixture.lockFile,
        "utf8"
      );

    const transaction =
      new FileTransaction(
        "rollback uninstall",
        fixture.root
      );

    const coordinator =
      new PackageUninstallMetadataCoordinator(
        fixture.root
      );

    coordinator.writeCache =
      async () => {
        throw new Error(
          "injected cache write failure"
        );
      };

    try {
      await assert.rejects(
        () =>
          coordinator.execute({
            packageId:
              TARGET,

            expectedState:
              fixture.state,

            expectedReceipt:
              target,

            transaction,

            mutateProject:
              async () => {
                await transaction
                  .recordModifiedFile(
                    projectFile
                  );

                await fs.writeFile(
                  projectFile,
                  "after\n",
                  "utf8"
                );
              },
          }),
        /injected cache write failure/u
      );

      assert.equal(
        await fs.readFile(
          projectFile,
          "utf8"
        ),
        beforeProject
      );

      assert.equal(
        await fs.readFile(
          fixture.stateFile,
          "utf8"
        ),
        beforeState
      );

      assert.equal(
        await fs.readFile(
          fixture.cacheFile,
          "utf8"
        ),
        beforeCache
      );

      assert.equal(
        await fs.readFile(
          fixture.lockFile,
          "utf8"
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
  "metadata coordinator keeps same-process CacheManager writes outside its three-file commit",
  async () => {
    const target =
      receipt(
        TARGET
      );

    const fixture =
      await createProject(
        [
          target,
        ]
      );

    const transaction =
      new FileTransaction(
        "serialized uninstall",
        fixture.root
      );

    const coordinator =
      new PackageUninstallMetadataCoordinator(
        fixture.root
      );

    const cacheManager =
      new CacheManager(
        fixture.root
      );

    let writeSettled =
      false;

    let blockedWrite;

    try {
      await coordinator.execute({
        packageId:
          TARGET,

        expectedState:
          fixture.state,

        expectedReceipt:
          target,

        transaction,

        mutateProject:
          async () => {
            blockedWrite =
              cacheManager
                .install(
                  "concurrent-package",
                  "9.9.9"
                )
                .then(
                  () => {
                    writeSettled =
                      true;
                  }
                );

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  30
                )
            );

            assert.equal(
              writeSettled,
              false
            );
          },
      });

      assert.ok(
        blockedWrite
      );

      await blockedWrite;

      const cache =
        await readJson(
          fixture.cacheFile
        );

      assert.equal(
        cache[
          TARGET
        ],
        undefined
      );

      assert.equal(
        cache[
          "concurrent-package"
        ].version,
        "9.9.9"
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
  "metadata coordinator fails if package state changes after planning",
  async () => {
    const target =
      receipt(
        TARGET
      );

    const fixture =
      await createProject(
        [
          target,
        ]
      );

    const transaction =
      new FileTransaction(
        "stale uninstall",
        fixture.root
      );

    const coordinator =
      new PackageUninstallMetadataCoordinator(
        fixture.root
      );

    let projectMutated =
      false;

    try {
      await writeJson(
        fixture.stateFile,
        packageState([
          target,
          receipt(
            OTHER
          ),
        ])
      );

      await assert.rejects(
        () =>
          coordinator.execute({
            packageId:
              TARGET,

            expectedState:
              fixture.state,

            expectedReceipt:
              target,

            transaction,

            mutateProject:
              async () => {
                projectMutated =
                  true;
              },
          }),
        /ownership state changed/u
      );

      assert.equal(
        projectMutated,
        false
      );

      assert.ok(
        (
          await readJson(
            fixture.stateFile
          )
        ).packages[
          OTHER
        ]
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
  "preserved shared file is revalidated during uninstall execution",
  async () => {
    const current =
      "shared\n";

    const target =
      receipt(
        TARGET,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "modified",

              sha256:
                sha256(current),

              previousSha256:
                sha256(
                  "before\n"
                ),
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          files: [
            {
              path:
                "shared.txt",

              action:
                "created",

              sha256:
                sha256(current),

              previousSha256:
                null,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          files: {
            "shared.txt":
              current,
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      await fs.writeFile(
        path.join(
          fixture.root,
          "shared.txt"
        ),
        "drifted\n",
        "utf8"
      );

      await assert.rejects(
        () =>
          uninstaller.apply(
            plan
          ),
        /digest no longer matches/u
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
  "preserved shared dependency is revalidated during uninstall execution",
  async () => {
    const originalOwner =
      receipt(
        OTHER,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                null,
            },
          ],
        }
      );

    const target =
      receipt(
        TARGET,
        {
          dependencies: [
            {
              name:
                "shared-dep",

              version:
                "2.0.0",

              previousVersion:
                "2.0.0",
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          originalOwner,
        ],
        {
          dependencies: {
            "shared-dep":
              "2.0.0",
          },
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      await writeJson(
        fixture.packageJsonFile,
        {
          name:
            "aurora-uninstall-fixture",

          version:
            "1.0.0",

          dependencies: {
            "shared-dep":
              "9.9.9",
          },
        }
      );

      await assert.rejects(
        () =>
          uninstaller.apply(
            plan
          ),
        /current version no longer matches/u
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
  "preserved shared environment marker is revalidated during uninstall execution",
  async () => {
    const target =
      receipt(
        TARGET,
        {
          environment: [
            {
              name:
                "SHARED_ENV",

              introduced:
                true,
            },
          ],
        }
      );

    const other =
      receipt(
        OTHER,
        {
          environment: [
            {
              name:
                "SHARED_ENV",

              introduced:
                true,
            },
          ],
        }
      );

    const fixture =
      await createProject(
        [
          target,
          other,
        ],
        {
          environment:
            "SHARED_ENV=\n",
        }
      );

    try {
      const {
        uninstaller,
      } =
        ownership(
          fixture
        );

      const plan =
        uninstaller.createPlan(
          target,
          fixture.state
        );

      await fs.writeFile(
        fixture.environmentFile,
        "",
        "utf8"
      );

      await assert.rejects(
        () =>
          uninstaller.apply(
            plan
          ),
        /missing or duplicated/u
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
  "WriteLock remains a process-wide serialization primitive",
  async () => {
    const first =
      new WriteLock();

    const second =
      new WriteLock();

    let secondAcquired =
      false;

    await first.acquire();

    const waiting =
      second.acquire()
        .then(
          () => {
            secondAcquired =
              true;

            second.release();
          }
        );

    try {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            20
          )
      );

      assert.equal(
        secondAcquired,
        false
      );
    }
    finally {
      first.release();
    }

    await waiting;

    assert.equal(
      secondAcquired,
      true
    );
  }
);
