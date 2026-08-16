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
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  PackageWorker,
} from "../../dist/packages/installation/packageWorker.js";

import {
  PackageTrustPolicy,
} from "../../dist/packages/trust/packageTrustPolicy.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

async function createProject() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-worker-environment-project-"
      )
    );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "worker-environment-test",
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

  return root;
}

async function createEnvironmentPackage(
  id,
  variableName,
  expectedValue
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-worker-environment-package-"
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
    [
      "export async function install(context) {",
      `  const value = await context.host.environment.read("${variableName}");`,
      `  if (value !== ${JSON.stringify(expectedValue)}) {`,
      "    throw new Error(\"environment-value-was-not-delivered\");",
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8"
  );

  await writePackageManifestV1(
    directory,
    {
      id,
      name: id,
      capabilities: [
        "package.code.execute",
        "host.environment.read",
      ],
      hostEnvironment: [
        {
          name: variableName,
          required: true,
        },
      ],
    }
  );

  return root;
}

function unsignedTrust() {
  return new PackageTrustPolicy({
    requireSignatures: false,
  });
}

function environmentPolicy(
  id,
  variableName
) {
  return {
    allowedCapabilities: [
      "package.code.execute",
    ],
    packageEnvironmentGrants: [
      {
        publisherId: "aurora-tests",
        packageId: id,
        variables: [
          variableName,
        ],
      },
    ],
  };
}

function trackedProvider(value) {
  const calls = [];

  return {
    calls,
    provider: {
      async readEnvironmentValue(
        identity,
        name
      ) {
        calls.push({
          packageId: identity.id,
          publisherId: identity.publisher.id,
          name,
        });

        return value;
      },
    },
  };
}

test(
  "PackageWorker composes an explicit trusted environment provider through PackageEnvironmentBroker",
  async () => {
    const id =
      "worker-environment-authorized";

    const variableName =
      "AURORA_REGION";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createEnvironmentPackage(
        id,
        variableName,
        "ke"
      );

    try {
      const tracked =
        trackedProvider("ke");

      const worker =
        new PackageWorker(
          packageRoot,
          environmentPolicy(
            id,
            variableName
          ),
          unsignedTrust(),
          undefined,
          tracked.provider
        );

      await worker.install(
        id,
        new InstallerContext(
          projectRoot
        )
      );

      assert.deepEqual(
        tracked.calls,
        [
          {
            packageId: id,
            publisherId: "aurora-tests",
            name: variableName,
          },
        ]
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
);

test(
  "PackageWorker default policy denies environment packages before provider access",
  async () => {
    const id =
      "worker-environment-default-deny";

    const variableName =
      "AURORA_REGION";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createEnvironmentPackage(
        id,
        variableName,
        "must-not-be-delivered"
      );

    try {
      const tracked =
        trackedProvider(
          "must-not-be-delivered"
        );

      const worker =
        new PackageWorker(
          packageRoot,
          {},
          unsignedTrust(),
          undefined,
          tracked.provider
        );

      await assert.rejects(
        worker.install(
          id,
          new InstallerContext(
            projectRoot
          )
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /host\.environment\.read/
          );

          assert.match(
            error.message,
            /package-scoped environment grant/
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
);

test(
  "PackageWorker has no default host environment provider even when authority is granted",
  async () => {
    const id =
      "worker-environment-no-provider";

    const variableName =
      "AURORA_REGION";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createEnvironmentPackage(
        id,
        variableName,
        "must-not-exist"
      );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          environmentPolicy(
            id,
            variableName
          ),
          unsignedTrust()
        );

      await assert.rejects(
        worker.install(
          id,
          new InstallerContext(
            projectRoot
          )
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /no trusted host environment reader is configured/
          );

          return true;
        }
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
);
