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
  source
) {
  const projectRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-installer-policy-project-"
      )
    );

  const packageRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-installer-policy-package-"
      )
    );

  const packageDirectory =
    join(packageRoot, id);

  await mkdir(
    packageDirectory,
    {
      recursive: true,
    }
  );

  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "installer-policy-test",
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
    source,
    "utf8"
  );

  await writePackageManifestV1(
    packageDirectory,
    {
      id,
      name: id,
      capabilities: [
        "package.code.execute",
        "host.secrets.read",
      ],
      secrets: [
        {
          name: "database-password",
          required: false,
        },
      ],
    }
  );

  return {
    projectRoot,
    packageRoot,
  };
}

function installer(
  fixture,
  executionPolicy
) {
  return new PackageInstaller({
    packageRoot:
      fixture.packageRoot,
    projectRoot:
      fixture.projectRoot,
    trust: {
      requireSignatures: false,
    },
    ...(executionPolicy === undefined
      ? {}
      : { executionPolicy }),
  });
}

async function cleanup(
  fixture
) {
  await rm(
    fixture.projectRoot,
    {
      recursive: true,
      force: true,
    }
  );

  await rm(
    fixture.packageRoot,
    {
      recursive: true,
      force: true,
    }
  );
}

test(
  "PackageInstaller default policy denies a manifest-declared secret capability before package execution",
  async () => {
    const id =
      "installer-secret-default-deny";

    const fixture =
      await createFixture(
        id,
        [
          "export async function install() {",
          "  throw new Error(\"package-code-must-not-execute\");",
          "}",
          "",
        ].join("\n")
      );

    try {
      await assert.rejects(
        installer(
          fixture
        ).install(id),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /host\.secrets\.read/
          );

          assert.match(
            error.message,
            /denied by the active package execution policy/
          );

          assert.doesNotMatch(
            error.message,
            /package-code-must-not-execute/
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
  "PackageInstaller accepts an explicit trusted execution policy without requiring a secret read",
  async () => {
    const id =
      "installer-secret-explicit-policy";

    const fixture =
      await createFixture(
        id,
        [
          "export async function install() {",
          "}",
          "",
        ].join("\n")
      );

    try {
      await installer(
        fixture,
        {
          allowedCapabilities: [
            "package.code.execute",
            "host.secrets.read",
          ],
        }
      ).install(id);

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
