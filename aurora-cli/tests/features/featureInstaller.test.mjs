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
  installFeature,
} from "../../dist/features/installers/featureInstaller.js";

async function exists(
  filePath
) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createProject() {
  const projectRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-feature-"
      )
    );

  const packageJson =
    JSON.stringify(
      {
        name:
          "aurora-feature-test",
        version: "1.0.0",
        private: true,
        dependencies: {},
      },
      null,
      2
    ) + "\n";

  await writeFile(
    join(
      projectRoot,
      "package.json"
    ),
    packageJson,
    "utf8"
  );

  return {
    projectRoot,
    packageJson,
  };
}

test(
  "Feature installer writes feature files and manifest transactionally",
  async () => {
    const {
      projectRoot,
    } =
      await createProject();

    const commands = [];

    const feature = {
      id: "demo",
      displayName: "Demo",
      description:
        "Demo feature",
      version: "1.0.0",
      dependencies: [
        "demo-package",
      ],

      async install(context) {
        await context.writeJson(
          ".aurora/demo.json",
          {
            installed: true,
          }
        );
      },
    };

    try {
      await installFeature(
        "demo",
        projectRoot,
        {
          featureResolver() {
            return feature;
          },

          async commandRunner(
            command,
            args,
            cwd
          ) {
            commands.push({
              command,
              args,
              cwd,
            });
          },
        }
      );

      assert.equal(
        commands.length,
        1
      );

      assert.deepEqual(
        commands[0].args,
        [
          "install",
          "--",
          "demo-package",
        ]
      );

      const configuration =
        JSON.parse(
          await readFile(
            join(
              projectRoot,
              ".aurora",
              "demo.json"
            ),
            "utf8"
          )
        );

      assert.deepEqual(
        configuration,
        {
          installed: true,
        }
      );

      const manifest =
        JSON.parse(
          await readFile(
            join(
              projectRoot,
              ".aurora",
              "features.json"
            ),
            "utf8"
          )
        );

      assert.deepEqual(
        manifest.installed,
        [
          "demo",
        ]
      );
    } finally {
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
  "Feature installer restores project files after installation failure",
  async () => {
    const {
      projectRoot,
      packageJson,
    } =
      await createProject();

    const originalLock =
      JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {},
        },
        null,
        2
      ) + "\n";

    const originalFeatureFile =
      JSON.stringify(
        {
          original: true,
        },
        null,
        2
      ) + "\n";

    const originalManifest =
      JSON.stringify(
        {
          installed: [
            "existing",
          ],
        },
        null,
        2
      ) + "\n";

    await writeFile(
      join(
        projectRoot,
        "package-lock.json"
      ),
      originalLock,
      "utf8"
    );

    await mkdir(
      join(
        projectRoot,
        ".aurora"
      ),
      {
        recursive: true,
      }
    );

    await writeFile(
      join(
        projectRoot,
        ".aurora",
        "auth.json"
      ),
      originalFeatureFile,
      "utf8"
    );

    await writeFile(
      join(
        projectRoot,
        ".aurora",
        "features.json"
      ),
      originalManifest,
      "utf8"
    );

    const commands = [];

    const feature = {
      id: "broken",
      displayName:
        "Broken Feature",
      description:
        "Expected failure",
      version: "1.0.0",
      dependencies: [
        "broken-package",
      ],

      async install(context) {
        await context.writeJson(
          ".aurora/auth.json",
          {
            original: false,
          }
        );

        await context.writeFile(
          "src/temporary-feature.txt",
          "temporary\n"
        );

        throw new Error(
          "Expected feature failure"
        );
      },
    };

    try {
      await assert.rejects(
        installFeature(
          "broken",
          projectRoot,
          {
            featureResolver() {
              return feature;
            },

            async commandRunner(
              command,
              args,
              cwd
            ) {
              commands.push({
                command,
                args,
                cwd,
              });

              if (
                args.length > 1
              ) {
                await writeFile(
                  join(
                    projectRoot,
                    "package.json"
                  ),
                  '{"modified":true}\n',
                  "utf8"
                );

                await writeFile(
                  join(
                    projectRoot,
                    "package-lock.json"
                  ),
                  '{"modified":true}\n',
                  "utf8"
                );

                await writeFile(
                  join(
                    projectRoot,
                    "npm-shrinkwrap.json"
                  ),
                  '{"created":true}\n',
                  "utf8"
                );
              }
            },
          }
        ),
        /Expected feature failure/
      );

      assert.equal(
        commands.length,
        2
      );

      assert.deepEqual(
        commands[1].args,
        [
          "install",
        ]
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "package.json"
          ),
          "utf8"
        ),
        packageJson
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "package-lock.json"
          ),
          "utf8"
        ),
        originalLock
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            ".aurora",
            "auth.json"
          ),
          "utf8"
        ),
        originalFeatureFile
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            ".aurora",
            "features.json"
          ),
          "utf8"
        ),
        originalManifest
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "temporary-feature.txt"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "npm-shrinkwrap.json"
          )
        ),
        false
      );
    } finally {
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
  "Feature install context rejects paths outside the project",
  async () => {
    const {
      projectRoot,
    } =
      await createProject();

    const escapedFile =
      join(
        projectRoot,
        "..",
        "escaped-feature.txt"
      );

    const feature = {
      id: "unsafe",
      displayName:
        "Unsafe Feature",
      description:
        "Unsafe path test",
      version: "1.0.0",
      dependencies: [],

      async install(context) {
        await context.writeFile(
          "../escaped-feature.txt",
          "unsafe\n"
        );
      },
    };

    try {
      await assert.rejects(
        installFeature(
          "unsafe",
          projectRoot,
          {
            featureResolver() {
              return feature;
            },
          }
        ),
        /escapes the project root/
      );

      assert.equal(
        await exists(
          escapedFile
        ),
        false
      );
    } finally {
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
  "Feature installation is idempotent",
  async () => {
    const {
      projectRoot,
    } =
      await createProject();

    let installationCount = 0;

    const feature = {
      id: "single",
      displayName:
        "Single Feature",
      description:
        "Idempotency test",
      version: "1.0.0",
      dependencies: [],

      async install(context) {
        installationCount += 1;

        await context.writeFile(
          ".aurora/single.txt",
          "installed\n"
        );
      },
    };

    const options = {
      featureResolver() {
        return feature;
      },
    };

    try {
      await installFeature(
        "single",
        projectRoot,
        options
      );

      await installFeature(
        "single",
        projectRoot,
        options
      );

      assert.equal(
        installationCount,
        1
      );

      const manifest =
        JSON.parse(
          await readFile(
            join(
              projectRoot,
              ".aurora",
              "features.json"
            ),
            "utf8"
          )
        );

      assert.deepEqual(
        manifest.installed,
        [
          "single",
        ]
      );
    } finally {
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
