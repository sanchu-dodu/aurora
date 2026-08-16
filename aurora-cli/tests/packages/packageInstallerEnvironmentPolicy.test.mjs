import test from "node:test";
import assert from "node:assert/strict";

import {
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
  PackageInstaller,
} from "../../dist/packages/installer/packageInstaller.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

async function createFixture(
  id,
  variableName,
  expectedValue
) {
  const projectRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-installer-environment-project-"
      )
    );

  const packageRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-installer-environment-package-"
      )
    );

  const packageDirectory =
    join(packageRoot, id);

  await mkdir(
    packageDirectory,
    { recursive: true }
  );

  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "installer-environment-test",
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
    join(packageDirectory, "install.js"),
    environmentInstallerSource(
      variableName,
      expectedValue
    ),
    "utf8"
  );

  await writePackageManifestV1(
    packageDirectory,
    environmentManifestOptions(
      id,
      variableName
    )
  );

  return {
    projectRoot,
    packageRoot,
  };
}

function environmentInstallerSource(
  variableName,
  expectedValue
) {
  return [
    "export async function install(context) {",
    `  const value = await context.host.environment.read("${variableName}");`,
    `  if (value !== ${JSON.stringify(expectedValue)}) {`,
    "    throw new Error(\"unexpected-environment-value\");",
    "  }",
    "}",
    "",
  ].join("\n");
}

function environmentManifestOptions(
  id,
  variableName,
  dependencies = []
) {
  return {
    id,
    name: id,
    dependencies,
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
  };
}

function grant(
  packageId,
  variableName
) {
  return {
    publisherId: "aurora-tests",
    packageId,
    variables: [variableName],
  };
}

function executionPolicy(
  grants
) {
  return {
    allowedCapabilities: [
      "package.code.execute",
    ],
    packageEnvironmentGrants: grants,
  };
}

function trackedProvider(
  valueFactory
) {
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

        return typeof valueFactory === "function"
          ? valueFactory(identity, name)
          : valueFactory;
      },
    },
  };
}

function installer(
  fixture,
  policy,
  provider
) {
  return new PackageInstaller({
    packageRoot: fixture.packageRoot,
    projectRoot: fixture.projectRoot,
    trust: {
      requireSignatures: false,
    },
    executionPolicy: policy,
    ...(provider === undefined
      ? {}
      : {
          environmentProvider: provider,
        }),
  });
}

async function cleanup(fixture) {
  await rm(
    fixture.projectRoot,
    { recursive: true, force: true }
  );

  await rm(
    fixture.packageRoot,
    { recursive: true, force: true }
  );
}

async function addEnvironmentDependency(
  fixture,
  rootId,
  rootVariable,
  rootExpectedValue,
  dependencyId,
  dependencyVariable,
  dependencyExpectedValue
) {
  const rootDirectory =
    join(
      fixture.packageRoot,
      rootId
    );

  const dependencyDirectory =
    join(
      fixture.packageRoot,
      dependencyId
    );

  await mkdir(
    dependencyDirectory,
    { recursive: true }
  );

  await writeFile(
    join(
      dependencyDirectory,
      "install.js"
    ),
    environmentInstallerSource(
      dependencyVariable,
      dependencyExpectedValue
    ),
    "utf8"
  );

  await writePackageManifestV1(
    dependencyDirectory,
    environmentManifestOptions(
      dependencyId,
      dependencyVariable
    )
  );

  await writeFile(
    join(
      rootDirectory,
      "install.js"
    ),
    environmentInstallerSource(
      rootVariable,
      rootExpectedValue
    ),
    "utf8"
  );

  await writePackageManifestV1(
    rootDirectory,
    environmentManifestOptions(
      rootId,
      rootVariable,
      [
        {
          id: dependencyId,
          version: "^1.0.0",
          optional: false,
        },
      ]
    )
  );
}

test(
  "PackageInstaller forwards explicit trusted environment provider to PackageWorker",
  async () => {
    const id =
      "installer-environment-authorized";

    const variableName =
      "AURORA_REGION";

    const fixture =
      await createFixture(
        id,
        variableName,
        "ke"
      );

    try {
      const tracked =
        trackedProvider("ke");

      await installer(
        fixture,
        executionPolicy([
          grant(id, variableName),
        ]),
        tracked.provider
      ).install(id);

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

      const cache =
        JSON.parse(
          await readFile(
            join(
              fixture.projectRoot,
              ".aurora",
              "cache.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        cache[id].version,
        "1.0.0"
      );
    }
    finally {
      await cleanup(fixture);
    }
  }
);

test(
  "PackageInstaller authority without an environment provider fails closed",
  async () => {
    const id =
      "installer-environment-no-provider";

    const variableName =
      "AURORA_REGION";

    const fixture =
      await createFixture(
        id,
        variableName,
        "must-not-be-delivered"
      );

    try {
      await assert.rejects(
        installer(
          fixture,
          executionPolicy([
            grant(id, variableName),
          ]),
          undefined
        ).install(id),
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
      await cleanup(fixture);
    }
  }
);

test(
  "root package environment grant does not authorize a dependency",
  async () => {
    const rootId =
      "installer-environment-root-scope";

    const dependencyId =
      "installer-environment-dependency-scope";

    const rootVariable =
      "AURORA_ROOT_REGION";

    const dependencyVariable =
      "AURORA_DEPENDENCY_REGION";

    const fixture =
      await createFixture(
        rootId,
        rootVariable,
        "root-value"
      );

    try {
      await addEnvironmentDependency(
        fixture,
        rootId,
        rootVariable,
        "root-value",
        dependencyId,
        dependencyVariable,
        "dependency-value"
      );

      const tracked =
        trackedProvider(
          () => "must-never-be-read"
        );

      await assert.rejects(
        installer(
          fixture,
          executionPolicy([
            grant(
              rootId,
              rootVariable
            ),
          ]),
          tracked.provider
        ).install(rootId),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            new RegExp(dependencyId)
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
      await cleanup(fixture);
    }
  }
);

test(
  "independent environment grants authorize root and dependency separately",
  async () => {
    const rootId =
      "installer-environment-root-independent";

    const dependencyId =
      "installer-environment-dependency-independent";

    const rootVariable =
      "AURORA_ROOT_REGION";

    const dependencyVariable =
      "AURORA_DEPENDENCY_REGION";

    const rootValue =
      `${rootId}:${rootVariable}`;

    const dependencyValue =
      `${dependencyId}:${dependencyVariable}`;

    const fixture =
      await createFixture(
        rootId,
        rootVariable,
        rootValue
      );

    try {
      await addEnvironmentDependency(
        fixture,
        rootId,
        rootVariable,
        rootValue,
        dependencyId,
        dependencyVariable,
        dependencyValue
      );

      const tracked =
        trackedProvider(
          (identity, name) =>
            `${identity.id}:${name}`
        );

      await installer(
        fixture,
        executionPolicy([
          grant(
            rootId,
            rootVariable
          ),
          grant(
            dependencyId,
            dependencyVariable
          ),
        ]),
        tracked.provider
      ).install(rootId);

      assert.deepEqual(
        tracked.calls
          .map(
            call =>
              `${call.packageId}:${call.name}`
          )
          .sort(),
        [
          `${dependencyId}:${dependencyVariable}`,
          `${rootId}:${rootVariable}`,
        ].sort()
      );

      assert.ok(
        tracked.calls.every(
          call =>
            call.publisherId ===
            "aurora-tests"
        )
      );

      const cache =
        JSON.parse(
          await readFile(
            join(
              fixture.projectRoot,
              ".aurora",
              "cache.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        cache[rootId].version,
        "1.0.0"
      );

      assert.equal(
        cache[dependencyId].version,
        "1.0.0"
      );
    }
    finally {
      await cleanup(fixture);
    }
  }
);
