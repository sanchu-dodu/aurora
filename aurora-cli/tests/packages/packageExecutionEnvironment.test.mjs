import test from "node:test";
import assert from "node:assert/strict";

import {
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
  PACKAGE_ENVIRONMENT_LIFECYCLE_MAX_BYTES,
  PackageExecutionHost,
} from "../../dist/packages/execution/packageExecutionHost.js";

import {
  PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES,
} from "../../dist/packages/execution/packageEnvironmentBroker.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

async function createProject() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-env-exec-project-"
      )
    );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "environment-execution-test",
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
        "aurora-env-exec-package-"
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

function environmentManifest(
  id,
  hostEnvironment
) {
  return createManifestV1({
    id,
    capabilities: [
      "package.code.execute",
      "host.environment.read",
    ],
    hostEnvironment,
  });
}

function environmentPolicy(
  id,
  variables
) {
  return new PackageCapabilityPolicy({
    allowedCapabilities: [
      "package.code.execute",
    ],
    packageEnvironmentGrants: [
      {
        publisherId: "aurora-tests",
        packageId: id,
        variables,
      },
    ],
  });
}

function trackedReader(value) {
  const calls = [];

  return {
    calls,
    reader: {
      async readEnvironmentVariable(
        manifest,
        name
      ) {
        calls.push({
          packageId: manifest.id,
          name,
        });

        return typeof value === "function"
          ? value(
              manifest,
              name,
              calls.length
            )
          : value;
      },
    },
  };
}

async function runCase({
  id,
  source,
  declarations,
  grants,
  reader,
}) {
  const projectRoot =
    await createProject();

  const packageRoot =
    await createPackageRoot(
      id,
      source
    );

  try {
    const executionHost =
      new PackageExecutionHost(
        environmentPolicy(
          id,
          grants
        ),
        undefined,
        reader
      );

    return await executionHost.run(
      environmentManifest(
        id,
        declarations
      ),
      packageRoot,
      "install.js",
      "install",
      new InstallerContext(
        projectRoot
      )
    );
  }
  finally {
    await rm(
      projectRoot,
      { recursive: true, force: true }
    );

    await rm(
      packageRoot,
      { recursive: true, force: true }
    );
  }
}

test(
  "controlled environment IPC exposes only the trusted reader value",
  async () => {
    const tracked =
      trackedReader("ke");

    const result =
      await runCase({
        id: "environment-ipc",
        source: [
          "export async function install(context) {",
          "  const direct = process.env.AURORA_REGION;",
          "  const value = await context.host.environment.read(\"AURORA_REGION\");",
          "  console.log(\"direct:\" + String(direct));",
          "  console.log(\"brokered:\" + value);",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      });

    assert.equal(result.executed, true);
    assert.match(result.stdout, /direct:undefined/);
    assert.match(result.stdout, /brokered:ke/);
    assert.deepEqual(
      tracked.calls,
      [
        {
          packageId: "environment-ipc",
          name: "AURORA_REGION",
        },
      ]
    );
  }
);

test(
  "ungranted declared variable fails before reader invocation",
  async () => {
    const tracked =
      trackedReader("true");

    await assert.rejects(
      runCase({
        id: "environment-exact-grant",
        source: [
          "export async function install(context) {",
          "  await context.host.environment.read(\"CI\");",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
          {
            name: "CI",
            required: false,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        return true;
      }
    );

    assert.equal(tracked.calls.length, 0);
  }
);

test(
  "missing environment reader fails closed",
  async () => {
    await assert.rejects(
      runCase({
        id: "environment-no-reader",
        source: [
          "export async function install(context) {",
          "  await context.host.environment.read(\"AURORA_REGION\");",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: undefined,
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        return true;
      }
    );
  }
);

test(
  "required null from custom reader fails at host boundary",
  async () => {
    const tracked = trackedReader(null);

    await assert.rejects(
      runCase({
        id: "environment-required-null",
        source: [
          "export async function install(context) {",
          "  await context.host.environment.read(\"AURORA_REGION\");",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_ENVIRONMENT_REQUIRED"
        );
        return true;
      }
    );
  }
);

test(
  "optional null crosses worker IPC as null",
  async () => {
    const tracked = trackedReader(null);

    const result =
      await runCase({
        id: "environment-optional-null",
        source: [
          "export async function install(context) {",
          "  const value = await context.host.environment.read(\"CI\");",
          "  console.log(\"optional:\" + String(value));",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "CI",
            required: false,
          },
        ],
        grants: ["CI"],
        reader: tracked.reader,
      });

    assert.match(result.stdout, /optional:null/);
  }
);

test(
  "host boundary rejects custom reader values above 64 KiB",
  async () => {
    const tracked =
      trackedReader(
        "a".repeat(
          PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES + 1
        )
      );

    await assert.rejects(
      runCase({
        id: "environment-host-value-limit",
        source: [
          "export async function install(context) {",
          "  await context.host.environment.read(\"AURORA_REGION\");",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_EXECUTION_FAILED"
        );
        return true;
      }
    );
  }
);

test(
  "exact 256 KiB environment lifecycle budget is permitted",
  async () => {
    assert.equal(
      PACKAGE_ENVIRONMENT_LIFECYCLE_MAX_BYTES,
      4 * PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
    );

    const tracked =
      trackedReader(
        "a".repeat(
          PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
        )
      );

    const result =
      await runCase({
        id: "environment-budget-exact",
        source: [
          "export async function install(context) {",
          "  for (let index = 0; index < 4; index += 1) {",
          "    await context.host.environment.read(\"AURORA_REGION\");",
          "  }",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      });

    assert.equal(result.executed, true);
    assert.equal(tracked.calls.length, 4);
  }
);

test(
  "repeated reads count again and exceeding 256 KiB fails closed",
  async () => {
    const tracked =
      trackedReader(
        "a".repeat(
          PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
        )
      );

    await assert.rejects(
      runCase({
        id: "environment-budget-over",
        source: [
          "export async function install(context) {",
          "  for (let index = 0; index < 5; index += 1) {",
          "    await context.host.environment.read(\"AURORA_REGION\");",
          "  }",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_READ_LIMIT"
        );
        return true;
      }
    );

    assert.equal(tracked.calls.length, 5);
  }
);

test(
  "malformed environment request input fails before reader invocation",
  async () => {
    const tracked = trackedReader("ke");

    await assert.rejects(
      runCase({
        id: "environment-malformed-input",
        source: [
          "export async function install(context) {",
          "  await context.host.environment.read({ bad: true });",
          "}",
          "",
        ].join("\n"),
        declarations: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
        grants: ["AURORA_REGION"],
        reader: tracked.reader,
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_EXECUTION_FAILED"
        );
        return true;
      }
    );

    assert.equal(tracked.calls.length, 0);
  }
);
