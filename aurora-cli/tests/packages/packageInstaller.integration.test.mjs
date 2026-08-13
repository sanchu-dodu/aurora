import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { CacheManager } from "../../dist/packages/cache/cacheManager.js";
import { LockManager } from "../../dist/packages/lock/lockManager.js";
import { PackageInstaller } from "../../dist/packages/installer/packageInstaller.js";
import { installPackage } from "../../dist/packages/installCommand.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

const cliRoot = process.cwd();

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createTemporaryProject() {
  const root = await mkdtemp(
    join(tmpdir(), "aurora-installer-")
  );

  await cp(
    join(cliRoot, "packages"),
    join(root, "packages"),
    {
      recursive: true,
    }
  );

  const packageJson =
    JSON.stringify(
      {
        name: "aurora-installer-test",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: {},
      },
      null,
      2
    ) + "\n";

  const environmentFile =
    "EXISTING_VALUE=preserved\n";

  await writeFile(
    join(root, "package.json"),
    packageJson,
    "utf8"
  );

  await writeFile(
    join(root, ".env"),
    environmentFile,
    "utf8"
  );

  return {
    root,
    packageJson,
    environmentFile,
  };
}

async function withTemporaryProject(callback) {
  const previousDirectory = process.cwd();
  const project = await createTemporaryProject();

  try {
    process.chdir(project.root);
    await callback(project);
  } finally {
    process.chdir(previousDirectory);

    await rm(
      project.root,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

test(
  "Cache and lock managers preserve concurrent package updates",
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "aurora-metadata-")
    );

    try {
      const packageIds = Array.from(
        {
          length: 20,
        },
        (_, index) => `package-${index + 1}`
      );

      await Promise.all(
        packageIds.map((packageId) =>
          new CacheManager(root).install(
            packageId,
            "1.0.0",
            packageId
          )
        )
      );

      await Promise.all(
        packageIds.map((packageId) =>
          new LockManager(root).register(
            packageId,
            "1.0.0"
          )
        )
      );

      const cache = JSON.parse(
        await readFile(
          join(root, ".aurora", "cache.json"),
          "utf8"
        )
      );

      const lock = JSON.parse(
        await readFile(
          join(root, "aurora.lock"),
          "utf8"
        )
      );

      assert.deepEqual(
        Object.keys(cache).sort(),
        [...packageIds].sort()
      );

      assert.deepEqual(
        Object.keys(lock.packages).sort(),
        [...packageIds].sort()
      );
    } finally {
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
  "PackageInstaller installs dependencies and records metadata",
  async () => {
    await withTemporaryProject(
      async ({ root }) => {
        const installer = new PackageInstaller({
          packageRoot: join(root, "packages"),
          projectRoot: root,
        });

        await installer.install("auth");

        assert.equal(
          await exists(
            join(root, "src", "auth.ts")
          ),
          true
        );

        const cache = JSON.parse(
          await readFile(
            join(root, ".aurora", "cache.json"),
            "utf8"
          )
        );

        const lock = JSON.parse(
          await readFile(
            join(root, "aurora.lock"),
            "utf8"
          )
        );

        const expectedPackages = [
          "auth",
          "database",
          "env",
        ];

        assert.deepEqual(
          Object.keys(cache).sort(),
          expectedPackages
        );

        assert.deepEqual(
          Object.keys(lock.packages).sort(),
          expectedPackages
        );
      }
    );
  }
);

test(
  "PackageInstaller rolls back project and metadata changes after failure",
  async () => {
    await withTemporaryProject(
      async ({
        root,
        packageJson,
        environmentFile,
      }) => {
        const brokenPackageDirectory =
          join(root, "packages", "broken");

        await mkdir(
          join(brokenPackageDirectory, "hooks"),
          {
            recursive: true,
          }
        );

        await mkdir(
          join(brokenPackageDirectory, "templates"),
          {
            recursive: true,
          }
        );

        await writeFile(
          join(
            brokenPackageDirectory,
            "install.js"
          ),
          `
export async function install(context) {
  context.log("Installing broken integration package...");
}
`,
          "utf8"
        );

        await writeFile(
          join(
            brokenPackageDirectory,
            "templates",
            "broken.txt.template"
          ),
          "This file must be removed during rollback.\n",
          "utf8"
        );

        await writeFile(
          join(
            brokenPackageDirectory,
            "hooks",
            "hooks.js"
          ),
          `
export async function afterInstall() {
  throw new Error("Expected integration failure");
}
`,
          "utf8"
        );

        await writePackageManifestV1(
          brokenPackageDirectory,
          {
            id: "broken",
            name:
              "Broken integration package",
            dependencies: [
              {
                id: "auth",
                version: "^1.0.0",
                optional: false,
              },
            ],
          }
        );

        const installer = new PackageInstaller({
          packageRoot: join(root, "packages"),
          projectRoot: root,
        });

        await assert.rejects(
          installer.install("broken"),
          /Expected integration failure/
        );

        assert.equal(
          await readFile(
            join(root, "package.json"),
            "utf8"
          ),
          packageJson
        );

        assert.equal(
          await readFile(
            join(root, ".env"),
            "utf8"
          ),
          environmentFile
        );

        assert.equal(
          await exists(
            join(root, "src", "auth.ts")
          ),
          false
        );

        assert.equal(
          await exists(
            join(root, "src", "broken.txt")
          ),
          false
        );

        assert.equal(
          await exists(
            join(root, ".aurora", "cache.json")
          ),
          false
        );

        assert.equal(
          await exists(
            join(root, "aurora.lock")
          ),
          false
        );
      }
    );
  }
);

test(
  "PackageInstaller restores pre-existing files and metadata after failure",
  async () => {
    await withTemporaryProject(
      async ({ root }) => {
        const originalAuthFile =
          "export const originalAuth = true;\n";

        const originalCache = {
          legacy: {
            version: "9.9.9",
            installedAt:
              "2026-01-01T00:00:00.000Z",
            checksum: "original-checksum",
            verified: true,
          },
        };

        const originalLock = {
          packages: {
            legacy: "9.9.9",
          },
        };

        await mkdir(
          join(root, "src"),
          {
            recursive: true,
          }
        );

        await mkdir(
          join(root, ".aurora"),
          {
            recursive: true,
          }
        );

        await writeFile(
          join(root, "src", "auth.ts"),
          originalAuthFile,
          "utf8"
        );

        await writeFile(
          join(
            root,
            ".aurora",
            "cache.json"
          ),
          JSON.stringify(
            originalCache,
            null,
            2
          ),
          "utf8"
        );

        await writeFile(
          join(root, "aurora.lock"),
          JSON.stringify(
            originalLock,
            null,
            2
          ),
          "utf8"
        );

        const brokenPackageDirectory =
          join(
            root,
            "packages",
            "existing-state-failure"
          );

        await mkdir(
          join(
            brokenPackageDirectory,
            "hooks"
          ),
          {
            recursive: true,
          }
        );

        await mkdir(
          join(
            brokenPackageDirectory,
            "templates"
          ),
          {
            recursive: true,
          }
        );

        await writeFile(
          join(
            brokenPackageDirectory,
            "install.js"
          ),
          `
export async function install(context) {
  context.log("Preparing existing-state failure...");
}
`,
          "utf8"
        );

        await writeFile(
          join(
            brokenPackageDirectory,
            "templates",
            "temporary.txt.template"
          ),
          "This file must not survive rollback.\n",
          "utf8"
        );

        await writeFile(
          join(
            brokenPackageDirectory,
            "hooks",
            "hooks.js"
          ),
          `
export async function afterInstall() {
  throw new Error("Expected existing-state failure");
}
`,
          "utf8"
        );

        await writePackageManifestV1(
          brokenPackageDirectory,
          {
            id:
              "existing-state-failure",
            name:
              "Existing state failure package",
            dependencies: [
              {
                id: "auth",
                version: "^1.0.0",
                optional: false,
              },
            ],
          }
        );

        const installer =
          new PackageInstaller({
            packageRoot: join(root, "packages"),
            projectRoot: root,
          });

        await assert.rejects(
          installer.install(
            "existing-state-failure"
          ),
          /Expected existing-state failure/
        );

        assert.equal(
          await readFile(
            join(root, "src", "auth.ts"),
            "utf8"
          ),
          originalAuthFile
        );

        const restoredCache =
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

        const restoredLock =
          JSON.parse(
            await readFile(
              join(root, "aurora.lock"),
              "utf8"
            )
          );

        assert.deepEqual(
          restoredCache,
          originalCache
        );

        assert.deepEqual(
          restoredLock,
          originalLock
        );

        assert.equal(
          await exists(
            join(
              root,
              "src",
              "temporary.txt"
            )
          ),
          false
        );
      }
    );
  }
);



test(
  "package install command reads packages from Aurora and writes to the target project",
  async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "aurora-external-project-")
    );

    const previousDirectory =
      process.cwd();

    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify(
          {
            name: "external-aurora-project",
            version: "1.0.0",
            private: true,
            type: "module",
            dependencies: {},
          },
          null,
          2
        ) + "\n",
        "utf8"
      );

      await writeFile(
        join(projectRoot, ".env"),
        "EXISTING_VALUE=preserved\n",
        "utf8"
      );

      process.chdir(projectRoot);

      await installPackage("auth");

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "auth.ts"
          )
        ),
        true
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          )
        ),
        true
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "aurora.lock"
          )
        ),
        true
      );

      assert.equal(
        await exists(
          join(projectRoot, "packages")
        ),
        false
      );

      const lock = JSON.parse(
        await readFile(
          join(
            projectRoot,
            "aurora.lock"
          ),
          "utf8"
        )
      );

      assert.deepEqual(
        Object.keys(lock.packages).sort(),
        [
          "auth",
          "database",
          "env",
        ]
      );
    } finally {
      process.chdir(previousDirectory);

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
