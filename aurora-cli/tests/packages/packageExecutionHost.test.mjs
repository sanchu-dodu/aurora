import test from "node:test";
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

import {
  PackageExecutionHost,
} from "../../dist/packages/execution/packageExecutionHost.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  PackageRegistry,
} from "../../dist/packages/registry/registry.js";

const cliRoot =
  process.cwd();

const builtinPackageRoot =
  join(
    cliRoot,
    "packages"
  );

async function exists(
  filePath
) {
  try {
    await access(
      filePath
    );

    return true;
  }
  catch {
    return false;
  }
}

async function createProject() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-worker-project-"
      )
    );

  await writeFile(
    join(
      root,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "package-worker-test",
        version:
          "1.0.0",
        private: true,
        type: "module",
        dependencies: {},
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return root;
}

async function createPackageRoot(
  id,
  source
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-worker-artifact-"
      )
    );

  const directory =
    join(
      root,
      id
    );

  await mkdir(
    directory,
    {
      recursive: true,
    }
  );

  await writeFile(
    join(
      directory,
      "install.js"
    ),
    source,
    "utf8"
  );

  return root;
}

function executionManifest(
  id,
  capabilities,
  environment = []
) {
  return {
    id,
    capabilities,
    environment,
  };
}

test(
  "package execution host brokers built-in auth installer operations",
  async () => {
    const projectRoot =
      await createProject();

    try {
      const registry =
        new PackageRegistry(
          builtinPackageRoot
        );

      const manifest =
        await registry.getPackage(
          "auth"
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      const host =
        new PackageExecutionHost();

      const before =
        await host.run(
          manifest,
          builtinPackageRoot,
          "hooks/hooks.js",
          "beforeInstall",
          context
        );

      assert.equal(
        before.executed,
        true
      );

      const install =
        await host.run(
          manifest,
          builtinPackageRoot,
          "install.js",
          "install",
          context
        );

      assert.equal(
        install.executed,
        true
      );

      const after =
        await host.run(
          manifest,
          builtinPackageRoot,
          "hooks/hooks.js",
          "afterInstall",
          context
        );

      assert.equal(
        after.executed,
        true
      );

      const packageJson =
        JSON.parse(
          await readFile(
            join(
              projectRoot,
              "package.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        packageJson
          .dependencies
          ["next-auth"],
        "^5.0.0"
      );

      const environment =
        await readFile(
          join(
            projectRoot,
            ".env.example"
          ),
          "utf8"
        );

      assert.match(
        environment,
        /AUTH_SECRET=/
      );

      assert.match(
        environment,
        /AUTH_URL=/
      );

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
    }
    finally {
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
  "package execution host denies undeclared project file writes",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "denied-write",
        `
export async function install(context) {
  await context.createFile(
    "forbidden.txt",
    "must not exist"
  );
}
`
      );

    try {
      const host =
        new PackageExecutionHost();

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        host.run(
          executionManifest(
            "denied-write",
            [
              "package.code.execute",
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /project\.files\.write/
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "forbidden.txt"
          )
        ),
        false
      );
    }
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package execution policy rejects ungranted network capability before execution",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "network-package",
        `
export async function install() {
  throw new Error(
    "This code must never execute."
  );
}
`
      );

    try {
      const host =
        new PackageExecutionHost();

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        host.run(
          executionManifest(
            "network-package",
            [
              "package.code.execute",
              "network.access",
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /network\.access/
          );

          return true;
        }
      );
    }
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package worker blocks direct Node built-in imports",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "builtin-import",
        `
import fs from "node:fs/promises";

export async function install() {
  await fs.writeFile(
    "forbidden.txt",
    "must not execute"
  );
}
`
      );

    try {
      const host =
        new PackageExecutionHost();

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        host.run(
          executionManifest(
            "builtin-import",
            [
              "package.code.execute",
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_EXECUTION_FAILED"
          );

          assert.match(
            error.message,
            /not allowed|failed/i
          );

          return true;
        }
      );
    }
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package worker blocks process.getBuiltinModule escape",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "builtin-escape",
        `
export async function install() {
  process.getBuiltinModule(
    "node:fs"
  );
}
`
      );

    try {
      const host =
        new PackageExecutionHost();

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        host.run(
          executionManifest(
            "builtin-escape",
            [
              "package.code.execute",
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_EXECUTION_FAILED"
          );

          assert.match(
            error.message,
            /built-in module access|failed/i
          );

          return true;
        }
      );
    }
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
test(
  "package execution host blocks generic file writes to protected project control surfaces",
  async () => {
    const projectRoot =
      await createProject();

    const originalPackageJson =
      await readFile(
        join(
          projectRoot,
          "package.json"
        ),
        "utf8"
      );

    const packageRoot =
      await createPackageRoot(
        "control-surface-write",
        `
export async function install(context) {
  await context.createFile(
    "package.json",
    '{"compromised": true}'
  );
}
`
      );

    try {
      const host =
        new PackageExecutionHost();

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        host.run(
          executionManifest(
            "control-surface-write",
            [
              "package.code.execute",
              "project.files.write",
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /protected project control surface/
          );

          return true;
        }
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "package.json"
          ),
          "utf8"
        ),
        originalPackageJson
      );
    }
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
