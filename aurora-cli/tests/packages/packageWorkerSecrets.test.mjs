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
        "aurora-package-worker-secret-project-"
      )
    );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "package-worker-secret-test",
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

async function createSecretPackage(
  id,
  secretName
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-worker-secret-package-"
      )
    );

  const directory =
    join(root, id);

  await mkdir(
    directory,
    {
      recursive: true,
    }
  );

  await writeFile(
    join(directory, "install.js"),
    [
      "export async function install(context) {",
      `  const value = await context.secrets.read("${secretName}");`,
      "  if (typeof value !== \"string\" || value.length === 0) {",
      "    throw new Error(\"secret-was-not-delivered\");",
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
        "host.secrets.read",
      ],
      secrets: [
        {
          name: secretName,
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

function trackedReader(
  value
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
  "PackageWorker forwards explicitly authorized secret reads to its trusted reader",
  async () => {
    const id =
      "worker-secret-authorized";

    const secretName =
      "database-password";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createSecretPackage(
        id,
        secretName
      );

    try {
      const tracked =
        trackedReader(
          "package-worker-test-secret-x91"
        );

      const worker =
        new PackageWorker(
          packageRoot,
          {
            allowedCapabilities: [
              "package.code.execute",
              "host.secrets.read",
            ],
          },
          unsignedTrust(),
          tracked.reader
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
            name: secretName,
          },
        ]
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
  "PackageWorker default policy denies secret packages before trusted-reader access",
  async () => {
    const id =
      "worker-secret-default-deny";

    const secretName =
      "database-password";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createSecretPackage(
        id,
        secretName
      );

    try {
      const tracked =
        trackedReader(
          "must-never-be-returned"
        );

      const worker =
        new PackageWorker(
          packageRoot,
          {},
          unsignedTrust(),
          tracked.reader
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
            /host\.secrets\.read/
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
