import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
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

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

const SECRET =
  "aurora-exact-secret-value-xq91-omega";

async function exists(filePath) {
  try {
    await access(filePath);
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
        "aurora-secret-execution-project-"
      )
    );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "secret-execution-test",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: {},
    }, null, 2) + "\n",
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
        "aurora-secret-execution-package-"
      )
    );

  const directory =
    join(root, id);

  await mkdir(
    directory,
    { recursive: true }
  );

  await writeFile(
    join(directory, "install.js"),
    source,
    "utf8"
  );

  return root;
}

function secretManifest(
  id,
  secrets,
  extraCapabilities = []
) {
  return createManifestV1({
    id,
    capabilities: [
      "package.code.execute",
      "host.secrets.read",
      ...extraCapabilities,
    ],
    secrets,
  });
}

function secretPolicy(
  extraCapabilities = []
) {
  return new PackageCapabilityPolicy({
    allowedCapabilities: [
      "package.code.execute",
      "host.secrets.read",
      ...extraCapabilities,
    ],
  });
}

function createReader(
  value = SECRET
) {
  const calls = [];

  return {
    calls,
    reader: {
      async readSecret(
        manifest,
        name
      ) {
        calls.push({
          packageId: manifest.id,
          name,
        });

        return value;
      },
    },
  };
}

test(
  "controlled secret IPC redacts worker logs stdout and stderr",
  async () => {
    const id = "secret-redaction";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  const value = await context.secrets.read(\"database-password\");",
          "  context.log(\"ipc-log:\" + value);",
          "  console.log(\"stdout:\" + value);",
          "  console.error(\"stderr:\" + value);",
          "}",
          "",
        ].join("\n")
      );

    try {
      const tracked =
        createReader();

      const host =
        new PackageExecutionHost(
          secretPolicy(),
          tracked.reader
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      const logs = [];

      context.log = message => {
        logs.push(String(message));
      };

      const result =
        await host.run(
          secretManifest(
            id,
            [
              {
                name: "database-password",
                required: true,
              },
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          context
        );

      assert.deepEqual(
        tracked.calls,
        [
          {
            packageId: id,
            name: "database-password",
          },
        ]
      );

      assert.equal(
        logs.length,
        1
      );

      assert.doesNotMatch(
        logs[0],
        new RegExp(SECRET)
      );

      assert.match(
        logs[0],
        /\[REDACTED\]/
      );

      assert.doesNotMatch(
        result.stdout,
        new RegExp(SECRET)
      );

      assert.match(
        result.stdout,
        /\[REDACTED\]/
      );

      assert.doesNotMatch(
        result.stderr,
        new RegExp(SECRET)
      );

      assert.match(
        result.stderr,
        /\[REDACTED\]/
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "worker failure messages redact an already released secret",
  async () => {
    const id = "secret-failure-redaction";
    const projectRoot = await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  const value = await context.secrets.read(\"failure-token\");",
          "  throw new Error(\"worker-failure:\" + value);",
          "}",
          "",
        ].join("\n")
      );

    try {
      const tracked = createReader();

      const host =
        new PackageExecutionHost(
          secretPolicy(),
          tracked.reader
        );

      const context =
        new InstallerContext(projectRoot);

      await assert.rejects(
        host.run(
          secretManifest(
            id,
            [
              {
                name: "failure-token",
                required: true,
              },
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

          assert.doesNotMatch(
            error.message,
            new RegExp(SECRET)
          );

          assert.match(
            error.message,
            /\[REDACTED\]/
          );

          return true;
        }
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "host denies a secret request when no trusted reader is configured",
  async () => {
    const id = "missing-secret-reader";
    const projectRoot = await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  await context.secrets.read(\"database-password\");",
          "}",
          "",
        ].join("\n")
      );

    try {
      const host =
        new PackageExecutionHost(
          secretPolicy()
        );

      await assert.rejects(
        host.run(
          secretManifest(
            id,
            [
              {
                name: "database-password",
                required: true,
              },
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          new InstallerContext(projectRoot)
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /no host secret broker is configured/
          );

          return true;
        }
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "host denies undeclared secret names before calling the reader",
  async () => {
    const id = "undeclared-secret-request";
    const projectRoot = await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  await context.secrets.read(\"other-secret\");",
          "}",
          "",
        ].join("\n")
      );

    try {
      const tracked = createReader();

      const host =
        new PackageExecutionHost(
          secretPolicy(),
          tracked.reader
        );

      await assert.rejects(
        host.run(
          secretManifest(
            id,
            [
              {
                name: "allowed-secret",
                required: true,
              },
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          new InstallerContext(projectRoot)
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /undeclared package secret/
          );

          return true;
        }
      );

      assert.equal(
        tracked.calls.length,
        0
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "default host policy denies secret capability before reader access",
  async () => {
    const id = "default-secret-policy-denial";
    const projectRoot = await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  await context.secrets.read(\"database-password\");",
          "}",
          "",
        ].join("\n")
      );

    try {
      const tracked = createReader();

      const host =
        new PackageExecutionHost(
          new PackageCapabilityPolicy(),
          tracked.reader
        );

      await assert.rejects(
        host.run(
          secretManifest(
            id,
            [
              {
                name: "database-password",
                required: true,
              },
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          new InstallerContext(projectRoot)
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /denied by the active package execution policy/
          );

          return true;
        }
      );

      assert.equal(
        tracked.calls.length,
        0
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "released raw secret cannot be written through privileged file broker",
  async () => {
    const id = "raw-secret-file-egress";
    const projectRoot = await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  const value = await context.secrets.read(\"database-password\");",
          "  await context.createFile(\"leak.txt\", \"prefix:\" + value);",
          "}",
          "",
        ].join("\n")
      );

    try {
      const tracked = createReader();

      const host =
        new PackageExecutionHost(
          secretPolicy([
            "project.files.write",
          ]),
          tracked.reader
        );

      await assert.rejects(
        host.run(
          secretManifest(
            id,
            [
              {
                name: "database-password",
                required: true,
              },
            ],
            [
              "project.files.write",
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          new InstallerContext(projectRoot)
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /released secret through privileged host request/
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(projectRoot, "leak.txt")
        ),
        false
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "optional missing secret crosses IPC only as null",
  async () => {
    const id = "optional-secret-null";
    const projectRoot = await createProject();

    const packageRoot =
      await createPackageRoot(
        id,
        [
          "export async function install(context) {",
          "  const value = await context.secrets.read(\"optional-token\");",
          "  if (value !== null) {",
          "    throw new Error(\"expected-null\");",
          "  }",
          "}",
          "",
        ].join("\n")
      );

    try {
      const tracked =
        createReader(null);

      const host =
        new PackageExecutionHost(
          secretPolicy(),
          tracked.reader
        );

      const result =
        await host.run(
          secretManifest(
            id,
            [
              {
                name: "optional-token",
                required: false,
              },
            ]
          ),
          packageRoot,
          "install.js",
          "install",
          new InstallerContext(projectRoot)
        );

      assert.equal(
        result.executed,
        true
      );

      assert.equal(
        tracked.calls.length,
        1
      );
    }
    finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);
