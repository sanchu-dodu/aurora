import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import test from "node:test";

import {
  PackageInstaller,
} from "../../dist/packages/installer/packageInstaller.js";

import {
  PackageWorker,
} from "../../dist/packages/installation/packageWorker.js";

import {
  LifecycleJournalStore,
} from "../../dist/packages/lifecycle/lifecycleJournalStore.js";

import {
  InstalledStateVerifier,
} from "../../dist/packages/verify/installedStateVerifier.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";


const INSTALL_EXECUTION_POLICY = {
  allowedCapabilities: [
    "package.code.execute",
    "project.files.write",
    "project.dependencies.write",
  ],
};


async function temporaryDirectory(
  prefix
) {
  return mkdtemp(
    join(
      tmpdir(),
      prefix
    )
  );
}


async function createProject(
  prefix
) {
  const root =
    await temporaryDirectory(
      prefix
    );

  await writeFile(
    join(
      root,
      "package.json"
    ),
    `${JSON.stringify(
      {
        name:
          "durable-install-test",

        version:
          "1.0.0",

        private:
          true,

        type:
          "module",

        dependencies: {},
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return root;
}


async function createPackage(
  packageRoot,
  id,
  {
    source,
    dependencies = [],
    capabilities,
  } = {}
) {
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

  if (source !== undefined) {
    await writeFile(
      join(
        packageDirectory,
        "install.js"
      ),
      source,
      "utf8"
    );
  }

  await writePackageManifestV1(
    packageDirectory,
    {
      id,
      name: id,
      dependencies,
      ...(capabilities === undefined
        ? {}
        : { capabilities }),
    }
  );
}


function installer(
  packageRoot,
  projectRoot,
  executionPolicy = {}
) {
  return new PackageInstaller({
    packageRoot,
    projectRoot,
    executionPolicy,

    trust: {
      requireSignatures:
        false,
    },
  });
}


async function readOnlyJournal(
  projectRoot
) {
  const journalRoot =
    join(
      projectRoot,
      ".aurora",
      "lifecycle-journal"
    );

  const entries =
    await readdir(
      journalRoot,
      {
        withFileTypes: true,
      }
    );

  const transactionDirectories =
    entries.filter(
      entry =>
        entry.isDirectory()
    );

  assert.equal(
    transactionDirectories.length,
    1
  );

  return new LifecycleJournalStore(
    projectRoot
  ).read(
    transactionDirectories[0]
      .name
  );
}


async function assertMissing(
  target
) {
  await assert.rejects(
    access(target),
    error =>
      error?.code ===
        "ENOENT"
  );
}


test(
  "PackageInstaller durably commits one serial dependency-batched installation while holding the project lifecycle lock",
  async () => {
    const projectRoot =
      await createProject(
        "aurora-durable-install-success-"
      );

    const packageRoot =
      await temporaryDirectory(
        "aurora-durable-install-packages-"
      );

    const originalInstall =
      PackageWorker
        .prototype
        .install;

    let activeInstallations =
      0;

    let maximumActiveInstallations =
      0;

    let observedInstallations =
      0;

    try {
      await createPackage(
        packageRoot,
        "batch-a"
      );

      await createPackage(
        packageRoot,
        "batch-b"
      );

      await createPackage(
        packageRoot,
        "batch-root",
        {
          dependencies: [
            {
              id: "batch-a",
              version: "^1.0.0",
              optional: false,
            },
            {
              id: "batch-b",
              version: "^1.0.0",
              optional: false,
            },
          ],
        }
      );

      PackageWorker
        .prototype
        .install =
        async function (
          ...args
        ) {
          activeInstallations +=
            1;

          maximumActiveInstallations =
            Math.max(
              maximumActiveInstallations,
              activeInstallations
            );

          try {
            const journal =
              await readOnlyJournal(
                projectRoot
              );

            assert.equal(
              journal.phase,
              "mutating"
            );

            assert.deepEqual(
              journal.files.map(
                file => file.path
              ),
              [
                ".aurora/cache.json",
                ".aurora/package-state.json",
                "aurora.lock",
              ]
            );

            await access(
              join(
                projectRoot,
                ".aurora",
                "lifecycle-lock"
              )
            );

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  25
                )
            );

            observedInstallations +=
              1;

            return await originalInstall
              .apply(
                this,
                args
              );
          }
          finally {
            activeInstallations -=
              1;
          }
        };

      await installer(
        packageRoot,
        projectRoot
      ).install(
        "batch-root"
      );

      assert.equal(
        observedInstallations,
        3
      );

      assert.equal(
        maximumActiveInstallations,
        1
      );

      const journal =
        await readOnlyJournal(
          projectRoot
        );

      assert.equal(
        journal.operation,
        "install"
      );

      assert.equal(
        journal.phase,
        "committed"
      );

      assert.deepEqual(
        journal.packageIds,
        [
          "batch-a",
          "batch-b",
          "batch-root",
        ]
      );

      const cache =
        JSON.parse(
          await readFile(
            join(
              projectRoot,
              ".aurora",
              "cache.json"
            ),
            "utf8"
          )
        );

      assert.deepEqual(
        Object.keys(
          cache
        ).sort(),
        [
          "batch-a",
          "batch-b",
          "batch-root",
        ]
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "lifecycle-lock"
        )
      );
    }
    finally {
      PackageWorker
        .prototype
        .install =
        originalInstall;

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
  "handled installation failure rolls back created directories and retains mutating durable evidence",
  async () => {
    const projectRoot =
      await createProject(
        "aurora-durable-install-rollback-"
      );

    const packageRoot =
      await temporaryDirectory(
        "aurora-durable-rollback-packages-"
      );

    try {
      await createPackage(
        packageRoot,
        "rollback-package",
        {
          source: `
export async function install(context) {
  await context.createFile(
    "generated/nested/output.txt",
    "temporary"
  );

  throw new Error(
    "forced-durable-installation-failure"
  );
}
`,

          capabilities: [
            "package.code.execute",
            "project.files.write",
          ],
        }
      );

      await assert.rejects(
        installer(
          packageRoot,
          projectRoot,
          INSTALL_EXECUTION_POLICY
        ).install(
          "rollback-package"
        ),
        /forced-durable-installation-failure/u
      );

      await assertMissing(
        join(
          projectRoot,
          "generated"
        )
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "cache.json"
        )
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "package-state.json"
        )
      );

      await assertMissing(
        join(
          projectRoot,
          "aurora.lock"
        )
      );

      const journal =
        await readOnlyJournal(
          projectRoot
        );

      assert.equal(
        journal.phase,
        "mutating"
      );

      assert.deepEqual(
        journal.directories.map(
          directory =>
            directory.path
        ),
        [
          "generated",
          "generated/nested",
        ]
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "lifecycle-lock"
        )
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
  "final installed-state verification failure rolls back and retains a verifying journal until after lock release",
  async () => {
    const projectRoot =
      await createProject(
        "aurora-durable-install-verification-"
      );

    const packageRoot =
      await temporaryDirectory(
        "aurora-durable-verification-packages-"
      );

    const originalVerify =
      InstalledStateVerifier
        .prototype
        .verify;

    let verificationCalls =
      0;

    try {
      await createPackage(
        packageRoot,
        "verification-package",
        {
          source: `
export async function install(context) {
  await context.createFile(
    "verification/nested/output.txt",
    "must roll back"
  );
}
`,

          capabilities: [
            "package.code.execute",
            "project.files.write",
          ],
        }
      );

      InstalledStateVerifier
        .prototype
        .verify =
        async function () {
          verificationCalls +=
            1;

          const journal =
            await readOnlyJournal(
              projectRoot
            );

          assert.equal(
            journal.phase,
            "verifying"
          );

          await access(
            join(
              projectRoot,
              ".aurora",
              "lifecycle-lock"
            )
          );

          throw new Error(
            "forced-final-install-verification-failure"
          );
        };

      await assert.rejects(
        installer(
          packageRoot,
          projectRoot,
          INSTALL_EXECUTION_POLICY
        ).install(
          "verification-package"
        ),
        /forced-final-install-verification-failure/u
      );

      assert.equal(
        verificationCalls,
        1
      );

      await assertMissing(
        join(
          projectRoot,
          "verification"
        )
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "cache.json"
        )
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "package-state.json"
        )
      );

      await assertMissing(
        join(
          projectRoot,
          "aurora.lock"
        )
      );

      const journal =
        await readOnlyJournal(
          projectRoot
        );

      assert.equal(
        journal.phase,
        "verifying"
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "lifecycle-lock"
        )
      );
    }
    finally {
      InstalledStateVerifier
        .prototype
        .verify =
        originalVerify;

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
  "package runtime serializes and drains concurrent privileged requests before lifecycle completion",
  async () => {
    const projectRoot =
      await createProject(
        "aurora-durable-install-request-queue-"
      );

    const packageRoot =
      await temporaryDirectory(
        "aurora-durable-request-packages-"
      );

    try {
      await createPackage(
        packageRoot,
        "request-queue-package",
        {
          source: `
export async function install(context) {
  for (let index = 0; index < 24; index += 1) {
    void context.config.addDependency(
      \`queued-dependency-\${String(index).padStart(2, "0")}\`,
      \`^1.0.\${index}\`
    );
  }
}
`,

          capabilities: [
            "package.code.execute",
            "project.dependencies.write",
          ],
        }
      );

      await installer(
        packageRoot,
        projectRoot,
        INSTALL_EXECUTION_POLICY
      ).install(
        "request-queue-package"
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

      const expectedDependencies =
        Object.fromEntries(
          Array.from(
            {
              length: 24,
            },
            (_, index) => [
              `queued-dependency-${String(index).padStart(2, "0")}`,
              `^1.0.${index}`,
            ]
          )
        );

      assert.deepEqual(
        packageJson.dependencies,
        expectedDependencies
      );

      assert.equal(
        (
          await readOnlyJournal(
            projectRoot
          )
        ).phase,
        "committed"
      );

      await assertMissing(
        join(
          projectRoot,
          ".aurora",
          "lifecycle-lock"
        )
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
