import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
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
import test from "node:test";

import {
  createEmptyPackageState,
  parsePackageState,
  parsePackageStateReceipt,
} from "../../dist/packages/state/packageStateSchema.js";

import {
  PackageStateStore,
} from "../../dist/packages/state/packageStateStore.js";

function receipt(
  id,
  overrides = {}
) {
  return {
    id,
    version: "1.0.0",
    publisherId:
      "aurora-tests",
    artifactSha256:
      "a".repeat(64),
    installedAt:
      "2026-08-19T09:00:00.000Z",
    files: [],
    dependencies: [],
    environment: [],
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

async function exists(
  file
) {
  try {
    await readFile(file);
    return true;
  }
  catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

test(
  "Package State v1 accepts a strict canonical receipt",
  () => {
    const parsed =
      parsePackageState({
        schemaVersion: 1,
        packages: {
          auth:
            receipt("auth"),
        },
      });

    assert.equal(
      parsed.schemaVersion,
      1
    );

    assert.equal(
      parsed.packages.auth.id,
      "auth"
    );
  }
);

test(
  "Package State v1 rejects unknown fields, key mismatches, invalid digests, timestamps, and versions",
  () => {
    assert.throws(
      () =>
        parsePackageState({
          schemaVersion: 1,
          packages: {},
          unexpected: true,
        })
    );

    assert.throws(
      () =>
        parsePackageState({
          schemaVersion: 1,
          packages: {
            auth:
              receipt(
                "database"
              ),
          },
        })
    );

    assert.throws(
      () =>
        parsePackageStateReceipt(
          receipt(
            "auth",
            {
              artifactSha256:
                "NOT-A-DIGEST",
            }
          )
        )
    );

    assert.throws(
      () =>
        parsePackageStateReceipt(
          receipt(
            "auth",
            {
              installedAt:
                "2026-08-19T09:00:00+00:00",
            }
          )
        )
    );

    assert.throws(
      () =>
        parsePackageStateReceipt(
          receipt(
            "auth",
            {
              version:
                "version-one",
            }
          )
        )
    );
  }
);

test(
  "Package State v1 enforces ownership semantics and rejects duplicate owned resources",
  () => {
    const digest =
      "b".repeat(64);

    assert.doesNotThrow(
      () =>
        parsePackageStateReceipt(
          receipt(
            "auth",
            {
              files: [
                {
                  path:
                    "src/auth.ts",
                  action:
                    "created",
                  sha256:
                    digest,
                  previousSha256:
                    null,
                },
              ],
              dependencies: [
                {
                  name:
                    "next-auth",
                  version:
                    "^5.0.0",
                  previousVersion:
                    null,
                },
              ],
              environment: [
                {
                  name:
                    "AUTH_SECRET",
                  introduced:
                    true,
                },
              ],
            }
          )
        )
    );

    assert.throws(
      () =>
        parsePackageStateReceipt(
          receipt(
            "auth",
            {
              files: [
                {
                  path:
                    "src/auth.ts",
                  action:
                    "created",
                  sha256:
                    digest,
                  previousSha256:
                    null,
                },
                {
                  path:
                    "SRC/AUTH.TS",
                  action:
                    "created",
                  sha256:
                    digest,
                  previousSha256:
                    null,
                },
              ],
            }
          )
        )
    );

    assert.throws(
      () =>
        parsePackageStateReceipt(
          receipt(
            "auth",
            {
              files: [
                {
                  path:
                    "src/auth.ts",
                  action:
                    "modified",
                  sha256:
                    digest,
                  previousSha256:
                    null,
                },
              ],
            }
          )
        )
    );
  }
);

test(
  "missing package state is an empty v1 state and reading it creates no file",
  async () => {
    const root =
      await temporaryProject(
        "aurora-package-state-empty-"
      );

    try {
      const store =
        new PackageStateStore(
          root
        );

      assert.deepEqual(
        await store.read(),
        createEmptyPackageState()
      );

      assert.equal(
        await exists(
          join(
            root,
            ".aurora",
            "package-state.json"
          )
        ),
        false
      );
    }
    finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package state persistence is deterministic",
  async () => {
    const root =
      await temporaryProject(
        "aurora-package-state-order-"
      );

    try {
      const store =
        new PackageStateStore(
          root
        );

      await store.upsertReceipt(
        receipt(
          "zeta"
        )
      );

      await store.upsertReceipt(
        receipt(
          "alpha"
        )
      );

      const stateFile =
        join(
          root,
          ".aurora",
          "package-state.json"
        );

      const first =
        await readFile(
          stateFile,
          "utf8"
        );

      const parsed =
        await store.read();

      await store.write(
        parsed
      );

      const second =
        await readFile(
          stateFile,
          "utf8"
        );

      assert.equal(
        first,
        second
      );

      assert.ok(
        first.indexOf(
          '"alpha"'
        ) <
        first.indexOf(
          '"zeta"'
        )
      );
    }
    finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "malformed state fails closed and is never replaced by an upsert",
  async () => {
    const root =
      await temporaryProject(
        "aurora-package-state-malformed-"
      );

    const stateDirectory =
      join(
        root,
        ".aurora"
      );

    const stateFile =
      join(
        stateDirectory,
        "package-state.json"
      );

    try {
      await mkdir(
        stateDirectory,
        {
          recursive: true,
        }
      );

      const malformed =
        "{ definitely not json";

      await writeFile(
        stateFile,
        malformed,
        "utf8"
      );

      const store =
        new PackageStateStore(
          root
        );

      await assert.rejects(
        store.upsertReceipt(
          receipt("auth")
        ),
        /invalid JSON/
      );

      assert.equal(
        await readFile(
          stateFile,
          "utf8"
        ),
        malformed
      );
    }
    finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "concurrent stores do not lose package receipts",
  async () => {
    const root =
      await temporaryProject(
        "aurora-package-state-concurrent-"
      );

    try {
      const packageIds =
        Array.from(
          {
            length: 24,
          },
          (
            _,
            index
          ) =>
            `package-${index + 1}`
        );

      await Promise.all(
        packageIds.map(
          packageId =>
            new PackageStateStore(
              root
            ).upsertReceipt(
              receipt(
                packageId
              )
            )
        )
      );

      const state =
        await new PackageStateStore(
          root
        ).read();

      assert.deepEqual(
        Object.keys(
          state.packages
        ).sort(),
        [...packageIds].sort()
      );
    }
    finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package-state writes do not mutate cache or lock metadata",
  async () => {
    const root =
      await temporaryProject(
        "aurora-package-state-isolation-"
      );

    const auroraDirectory =
      join(
        root,
        ".aurora"
      );

    const cacheFile =
      join(
        auroraDirectory,
        "cache.json"
      );

    const lockFile =
      join(
        root,
        "aurora.lock"
      );

    const cacheContent =
      JSON.stringify(
        {
          legacy: {
            version:
              "9.9.9",
          },
        },
        null,
        2
      );

    const lockContent =
      JSON.stringify(
        {
          packages: {
            legacy:
              "9.9.9",
          },
        },
        null,
        2
      );

    try {
      await mkdir(
        auroraDirectory,
        {
          recursive: true,
        }
      );

      await writeFile(
        cacheFile,
        cacheContent,
        "utf8"
      );

      await writeFile(
        lockFile,
        lockContent,
        "utf8"
      );

      await new PackageStateStore(
        root
      ).upsertReceipt(
        receipt("auth")
      );

      assert.equal(
        await readFile(
          cacheFile,
          "utf8"
        ),
        cacheContent
      );

      assert.equal(
        await readFile(
          lockFile,
          "utf8"
        ),
        lockContent
      );
    }
    finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package-state persistence rejects a symbolic-link or junction escape",
  async () => {
    const sandbox =
      await temporaryProject(
        "aurora-package-state-boundary-"
      );

    const projectRoot =
      join(
        sandbox,
        "project"
      );

    const outsideRoot =
      join(
        sandbox,
        "outside"
      );

    const auroraPath =
      join(
        projectRoot,
        ".aurora"
      );

    try {
      await mkdir(
        projectRoot,
        {
          recursive: true,
        }
      );

      await mkdir(
        outsideRoot,
        {
          recursive: true,
        }
      );

      await symlink(
        outsideRoot,
        auroraPath,
        process.platform ===
          "win32"
          ? "junction"
          : "dir"
      );

      await assert.rejects(
        new PackageStateStore(
          projectRoot
        ).upsertReceipt(
          receipt("auth")
        )
      );

      assert.equal(
        await exists(
          join(
            outsideRoot,
            "package-state.json"
          )
        ),
        false
      );
    }
    finally {
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