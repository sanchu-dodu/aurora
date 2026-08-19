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

function createUnsignedCompatibilityWorker(
  packageRoot
) {
  return new PackageWorker(
    packageRoot,
    {},
    new PackageTrustPolicy({
      requireSignatures:
        false,
    })
  );
}

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
        "aurora-package-worker-integration-"
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
          "package-worker-integration",
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

async function createPackage(
  id,
  source,
  overrides = {}
) {
  const packageRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-worker-source-"
      )
    );

  const packageDirectory =
    join(
      packageRoot,
      id
    );

  await mkdir(
    packageDirectory,
    {
      recursive: true,
    }
  );

  const installerPath =
    join(
      packageDirectory,
      "install.js"
    );

  await writeFile(
    installerPath,
    source,
    "utf8"
  );

  await writePackageManifestV1(
    packageDirectory,
    {
      id,
      name: id,
      ...overrides,
    }
  );

  return {
    packageRoot,
    packageDirectory,
    installerPath,
  };
}

test(
  "PackageWorker executes installer code outside the main CLI process",
  async () => {
    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "isolated-worker",
        `
globalThis.__auroraPackageIsolationTripwire =
  "child-process";

export async function install() {
}
`
      );

    try {
      delete globalThis
        .__auroraPackageIsolationTripwire;

      const worker =
        createUnsignedCompatibilityWorker(
          packageArtifact
            .packageRoot
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      await worker.install(
        "isolated-worker",
        context
      );

      assert.equal(
        globalThis
          .__auroraPackageIsolationTripwire,
        undefined
      );
    }
    finally {
      delete globalThis
        .__auroraPackageIsolationTripwire;

      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "PackageWorker verifies artifact integrity immediately before execution",
  async () => {
    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "tampered-worker",
        `
export async function install(context) {
  await context.createFile(
    "tamper-executed.txt",
    "original"
  );
}
`,
        {
          capabilities: [
            "package.code.execute",
            "project.files.write",
          ],
        }
      );

    try {
      /*
       * Modify executable content AFTER the
       * manifest digest has been generated.
       */
      await writeFile(
        packageArtifact
          .installerPath,
        `
export async function install(context) {
  await context.createFile(
    "tamper-executed.txt",
    "tampered code executed"
  );
}
`,
        "utf8"
      );

      const worker =
        createUnsignedCompatibilityWorker(
          packageArtifact
            .packageRoot
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        worker.install(
          "tampered-worker",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_INTEGRITY_FAILED"
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "tamper-executed.txt"
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
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "PackageWorker rejects ungranted network capability before host-side template mutation",
  async () => {
    const projectRoot =
      await createProject();

    const packageRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-template-policy-"
        )
      );

    const packageDirectory =
      join(
        packageRoot,
        "blocked-template"
      );

    await mkdir(
      join(
        packageDirectory,
        "templates"
      ),
      {
        recursive: true,
      }
    );

    await writeFile(
      join(
        packageDirectory,
        "templates",
        "blocked.txt.template"
      ),
      "must never be installed\n",
      "utf8"
    );

    await writePackageManifestV1(
      packageDirectory,
      {
        id:
          "blocked-template",
        name:
          "blocked-template",
        capabilities: [
          "project.files.write",
          "network.access",
        ],
        networkAccess: [
          {
            origin:
              "https://api.example.com",
            methods: [
              "GET",
            ],
          },
        ],
      }
    );

    try {
      const worker =
        createUnsignedCompatibilityWorker(
          packageRoot
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        worker.install(
          "blocked-template",
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

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "blocked.txt"
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
  "PackageWorker preserves the declared installer export contract",
  async () => {
    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "missing-install-export",
        `
export const notAnInstaller = true;
`
      );

    try {
      const worker =
        createUnsignedCompatibilityWorker(
          packageArtifact
            .packageRoot
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        worker.install(
          "missing-install-export",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "INVALID_PACKAGE_MANIFEST"
          );

          assert.match(
            error.message,
            /does not export an install function/
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
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
