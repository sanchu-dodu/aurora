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
        const installer = new PackageInstaller();

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
            "manifest.json"
          ),
          JSON.stringify(
            {
              id: "broken",
              name: "Broken integration package",
              version: "1.0.0",
              dependencies: ["auth"],
            },
            null,
            2
          ),
          "utf8"
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

        const installer = new PackageInstaller();

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
