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
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

import {
  PackageExecutionHost,
} from "../../dist/packages/execution/packageExecutionHost.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

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
        "aurora-package-adversarial-project-"
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
          "aurora-package-adversarial",
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
        "aurora-package-adversarial-artifact-"
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

function manifest(
  id,
  capabilities
) {
  return {
    id,
    capabilities,
    environment: [],
  };
}

async function cleanup(
  projectRoot,
  packageRoot
) {
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

test(
  "package worker does not inherit arbitrary parent environment secrets",
  async () => {
    const secretName =
      "AURORA_PACKAGE_PARENT_SECRET";

    const secretValue =
      "parent-secret-must-not-cross-worker-boundary";

    const previous =
      process.env[secretName];

    process.env[secretName] =
      secretValue;

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "environment-isolation",
        `
export async function install(context) {
  await context.createFile(
    'src/parent-secret.txt',
    String(
      process.env.AURORA_PACKAGE_PARENT_SECRET
    )
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

      await host.run(
        manifest(
          "environment-isolation",
          [
            "package.code.execute",
            "project.files.write",
          ]
        ),
        packageRoot,
        "install.js",
        "install",
        context
      );

      const observed =
        await readFile(
          join(
            projectRoot,
            "src",
            "parent-secret.txt"
          ),
          "utf8"
        );

      assert.equal(
        observed,
        "undefined"
      );

      assert.notEqual(
        observed,
        secretValue
      );
    }
    finally {
      if (
        previous ===
        undefined
      ) {
        delete process.env[
          secretName
        ];
      }
      else {
        process.env[
          secretName
        ] = previous;
      }

      await cleanup(
        projectRoot,
        packageRoot
      );
    }
  }
);

test(
  "package worker blocks direct fetch network access",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "direct-network",
        `
export async function install() {
  await fetch(
    'https://example.com'
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
          manifest(
            "direct-network",
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
            /network access|failed/i
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageRoot
      );
    }
  }
);

test(
  "package worker blocks direct package access to process IPC",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "direct-ipc",
        `
export async function install() {
  process.send({
    type: 'completed',
    executed: true
  });
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
          manifest(
            "direct-ipc",
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
            /IPC access|failed/i
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageRoot
      );
    }
  }
);

test(
  "host policy can deny a capability even when the manifest declares it",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "host-policy-denial",
        `
export async function install(context) {
  await context.createFile(
    'src/host-policy-bypass.txt',
    'must not exist'
  );
}
`
      );

    try {
      const policy =
        new PackageCapabilityPolicy({
          allowedCapabilities: [
            "package.code.execute",
          ],
        });

      const host =
        new PackageExecutionHost(
          policy
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        host.run(
          manifest(
            "host-policy-denial",
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
            /project\.files\.write/
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "host-policy-bypass.txt"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageRoot
      );
    }
  }
);

test(
  "package lifecycle executions do not share module-local process state",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "lifecycle-isolation",
        `
let lifecycleState = 0;

export async function beforeInstall(context) {
  lifecycleState = 1;

  await context.createFile(
    'src/before-state.txt',
    String(lifecycleState)
  );
}

export async function afterInstall(context) {
  await context.createFile(
    'src/after-state.txt',
    String(lifecycleState)
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

      const packageManifest =
        manifest(
          "lifecycle-isolation",
          [
            "package.code.execute",
            "project.files.write",
          ]
        );

      await host.run(
        packageManifest,
        packageRoot,
        "install.js",
        "beforeInstall",
        context
      );

      await host.run(
        packageManifest,
        packageRoot,
        "install.js",
        "afterInstall",
        context
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "src",
            "before-state.txt"
          ),
          "utf8"
        ),
        "1"
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "src",
            "after-state.txt"
          ),
          "utf8"
        ),
        "0"
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageRoot
      );
    }
  }
);

test(
  "package worker enforces the output byte limit",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        "output-flood",
        `
export async function install() {
  console.log(
    'x'.repeat(
      2 * 1024 * 1024
    )
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
          manifest(
            "output-flood",
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
            "PACKAGE_OUTPUT_LIMIT"
          );

          assert.match(
            error.message,
            /output limit/i
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageRoot
      );
    }
  }
);
