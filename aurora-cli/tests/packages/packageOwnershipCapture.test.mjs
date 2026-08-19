import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  mkdir,
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
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  PackageInstaller,
} from "../../dist/packages/installer/packageInstaller.js";

import {
  PackageOwnershipRecorder,
} from "../../dist/packages/state/packageOwnershipRecorder.js";

import {
  PackageStateStore,
} from "../../dist/packages/state/packageStateStore.js";


function sha256(
  value
) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}


function fakeManifest(
  id
) {
  return {
    id,
    version:
      "1.0.0",

    publisher: {
      id:
        "aurora-tests",
    },

    artifact: {
      digest:
        "a".repeat(64),
    },
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
    if (
      error?.code ===
        "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}


async function writeProjectManifest(
  root
) {
  await writeFile(
    join(
      root,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "aurora-lifecycle-test",

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
    ),
    "utf8"
  );
}


function authExecutionPolicy() {
  return {
    allowedCapabilities: [
      "package.code.execute",
      "project.files.write",
      "project.dependencies.write",
      "project.environment.write",
    ],
  };
}


test(
  "package-scoped context captures created and modified files plus dependency and environment ownership",
  async () => {
    const root =
      await temporaryProject(
        "aurora-ownership-context-"
      );

    try {
      await mkdir(
        join(
          root,
          "src"
        ),
        {
          recursive:
            true,
        }
      );

      const originalExisting =
        "export const oldValue = true;\n";

      await writeFile(
        join(
          root,
          "src",
          "existing.ts"
        ),
        originalExisting,
        "utf8"
      );

      await writeFile(
        join(
          root,
          "package.json"
        ),
        JSON.stringify(
          {
            name:
              "ownership-test",

            version:
              "1.0.0",

            dependencies: {
              "existing-dep":
                "^1.0.0",
            },
          },
          null,
          2
        ),
        "utf8"
      );

      await writeFile(
        join(
          root,
          ".env.example"
        ),
        "EXISTING=\n",
        "utf8"
      );

      const rootContext =
        new InstallerContext(
          root
        );

      const recorder =
        new PackageOwnershipRecorder(
          root,
          fakeManifest(
            "ownership-test"
          )
        );

      const context =
        rootContext
          .createPackageScope(
            recorder
          );

      await context.createFile(
        "src/new.ts",
        "first\n"
      );

      await context.createFile(
        "src/new.ts",
        "final\n"
      );

      await context.createFile(
        "src/existing.ts",
        "replacement\n"
      );

      await context.config
        .addDependency(
          "existing-dep",
          "^2.0.0"
        );

      await context.config
        .addDependency(
          "new-dep",
          "^1.0.0"
        );

      await context.env
        .addVariables([
          "EXISTING",
          "NEW_VAR",
        ]);

      const receipt =
        await recorder.finalize();

      assert.equal(
        receipt.files.length,
        2
      );

      const created =
        receipt.files.find(
          file =>
            file.path ===
              "src/new.ts"
        );

      assert.ok(created);

      assert.equal(
        created.action,
        "created"
      );

      assert.equal(
        created.previousSha256,
        null
      );

      assert.equal(
        created.sha256,
        sha256(
          "final\n"
        )
      );

      const modified =
        receipt.files.find(
          file =>
            file.path ===
              "src/existing.ts"
        );

      assert.ok(modified);

      assert.equal(
        modified.action,
        "modified"
      );

      assert.equal(
        modified.previousSha256,
        sha256(
          originalExisting
        )
      );

      assert.equal(
        modified.sha256,
        sha256(
          "replacement\n"
        )
      );

      assert.deepEqual(
        receipt.dependencies,
        [
          {
            name:
              "existing-dep",

            version:
              "^2.0.0",

            previousVersion:
              "^1.0.0",
          },
          {
            name:
              "new-dep",

            version:
              "^1.0.0",

            previousVersion:
              null,
          },
        ]
      );

      assert.deepEqual(
        receipt.environment,
        [
          {
            name:
              "EXISTING",

            introduced:
              false,
          },
          {
            name:
              "NEW_VAR",

            introduced:
              true,
          },
        ]
      );

      rootContext.transaction
        .commit();
    }
    finally {
      await rm(
        root,
        {
          recursive:
            true,

          force:
            true,
        }
      );
    }
  }
);


test(
  "concurrent package scopes cannot exchange file ownership",
  async () => {
    const root =
      await temporaryProject(
        "aurora-ownership-concurrency-"
      );

    try {
      const rootContext =
        new InstallerContext(
          root
        );

      const recorderA =
        new PackageOwnershipRecorder(
          root,
          fakeManifest(
            "package-a"
          )
        );

      const recorderB =
        new PackageOwnershipRecorder(
          root,
          fakeManifest(
            "package-b"
          )
        );

      const contextA =
        rootContext
          .createPackageScope(
            recorderA
          );

      const contextB =
        rootContext
          .createPackageScope(
            recorderB
          );

      await Promise.all([
        contextA.createFile(
          "src/a.ts",
          "a\n"
        ),

        contextB.createFile(
          "src/b.ts",
          "b\n"
        ),
      ]);

      const [
        receiptA,
        receiptB,
      ] =
        await Promise.all([
          recorderA.finalize(),
          recorderB.finalize(),
        ]);

      assert.deepEqual(
        receiptA.files.map(
          file =>
            file.path
        ),
        [
          "src/a.ts",
        ]
      );

      assert.deepEqual(
        receiptB.files.map(
          file =>
            file.path
        ),
        [
          "src/b.ts",
        ]
      );

      rootContext.transaction
        .commit();
    }
    finally {
      await rm(
        root,
        {
          recursive:
            true,

          force:
            true,
        }
      );
    }
  }
);


test(
  "PackageInstaller persists built-in auth ownership without changing cache or lock semantics",
  async () => {
    const root =
      await temporaryProject(
        "aurora-ownership-auth-"
      );

    try {
      await writeProjectManifest(
        root
      );

      await new PackageInstaller({
        projectRoot:
          root,

        executionPolicy:
          authExecutionPolicy(),
      }).install(
        "auth"
      );

      const state =
        await new PackageStateStore(
          root
        ).read();

      const auth =
        state.packages.auth;

      assert.ok(auth);

      const authManifest =
        JSON.parse(
          await readFile(
            join(
              process.cwd(),
              "packages",
              "auth",
              "manifest.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        auth.version,
        authManifest.version
      );

      assert.equal(
        auth.publisherId,
        authManifest.publisher.id
      );

      assert.equal(
        auth.artifactSha256,
        authManifest.artifact.digest
      );

      const authFile =
        auth.files.find(
          file =>
            file.path ===
              "src/auth.ts"
        );

      assert.ok(authFile);

      assert.equal(
        auth.files.filter(
          file =>
            file.path ===
              "src/auth.ts"
        ).length,
        1
      );

      const currentAuthContent =
        await readFile(
          join(
            root,
            "src",
            "auth.ts"
          )
        );

      assert.equal(
        authFile.sha256,
        sha256(
          currentAuthContent
        )
      );

      const nextAuth =
        auth.dependencies.find(
          dependency =>
            dependency.name ===
              "next-auth"
        );

      assert.deepEqual(
        nextAuth,
        {
          name:
            "next-auth",

          version:
            "^5.0.0",

          previousVersion:
            null,
        }
      );

      assert.deepEqual(
        auth.environment,
        [
          {
            name:
              "AUTH_SECRET",

            introduced:
              true,
          },
          {
            name:
              "AUTH_URL",

            introduced:
              true,
          },
        ]
      );

      assert.ok(
        state.packages.database
      );

      assert.ok(
        state.packages.env
      );

      const cache =
        JSON.parse(
          await readFile(
            join(
              root,
              ".aurora",
              "cache.json"
            ),
            "utf8"
          )
        );

      const lock =
        JSON.parse(
          await readFile(
            join(
              root,
              "aurora.lock"
            ),
            "utf8"
          )
        );

      assert.deepEqual(
        Object.keys(
          cache
        ).sort(),
        [
          "auth",
          "database",
          "env",
        ]
      );

      assert.deepEqual(
        Object.keys(
          lock.packages
        ).sort(),
        [
          "auth",
          "database",
          "env",
        ]
      );
    }
    finally {
      await rm(
        root,
        {
          recursive:
            true,

          force:
            true,
        }
      );
    }
  }
);


test(
  "PackageInstaller rolls package-state metadata back when lifecycle state persistence fails",
  async () => {
    const root =
      await temporaryProject(
        "aurora-ownership-rollback-"
      );

    const originalUpsert =
      PackageStateStore
        .prototype
        .upsertReceipt;

    let upsertCount =
      0;

    try {
      await writeProjectManifest(
        root
      );

      PackageStateStore
        .prototype
        .upsertReceipt =
        async function (
          receipt
        ) {
          await originalUpsert.call(
            this,
            receipt
          );

          upsertCount +=
            1;

          throw new Error(
            "forced-package-state-post-write-failure"
          );
        };

      await assert.rejects(
        new PackageInstaller({
          projectRoot:
            root,

          executionPolicy:
            authExecutionPolicy(),
        }).install(
          "auth"
        ),
        /forced-package-state-post-write-failure/
      );

      assert.ok(
        upsertCount > 0
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

      assert.equal(
        await exists(
          join(
            root,
            ".aurora",
            "cache.json"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            root,
            "aurora.lock"
          )
        ),
        false
      );
    }
    finally {
      PackageStateStore
        .prototype
        .upsertReceipt =
        originalUpsert;

      await rm(
        root,
        {
          recursive:
            true,

          force:
            true,
        }
      );
    }
  }
);