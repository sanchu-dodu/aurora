import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import "../../dist/templates/registerNext.js";

import {
  installProject,
} from "../../dist/services/installService.js";

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

test(
  "Template installation uses the canonical local project engine",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-template-install-"
        )
      );

    const operations = [];

    const projectName =
      "installed-template";

    const projectPath =
      join(
        workspaceRoot,
        projectName
      );

    try {
      const installed =
        await installProject(
          "nextjs",
          projectName,
          {
            installDependencies:
              true,

            initializeGit:
              true,

            projectCreation: {
              workspaceRoot,

              async dependencyInstaller(
                receivedProjectPath,
                packageManager
              ) {
                operations.push({
                  type:
                    "dependencies",
                  projectPath:
                    receivedProjectPath,
                  packageManager,
                });
              },

              async gitInitializer(
                receivedProjectPath
              ) {
                operations.push({
                  type: "git",
                  projectPath:
                    receivedProjectPath,
                });
              },
            },
          }
        );

      assert.equal(
        installed,
        true
      );

      assert.deepEqual(
        operations,
        [
          {
            type:
              "dependencies",
            projectPath,
            packageManager: "npm",
          },
          {
            type: "git",
            projectPath,
          },
        ]
      );

      const packageJson =
        JSON.parse(
          await readFile(
            join(
              projectPath,
              "package.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        packageJson.name,
        projectName
      );

      assert.equal(
        packageJson.dependencies.next,
        "latest"
      );

      const auroraConfig =
        JSON.parse(
          await readFile(
            join(
              projectPath,
              "aurora.config.json"
            ),
            "utf8"
          )
        );

      assert.equal(
        auroraConfig.framework,
        "nextjs"
      );

      assert.equal(
        auroraConfig.language,
        "typescript"
      );

      assert.equal(
        auroraConfig.packageManager,
        "npm"
      );
    } finally {
      await rm(
        workspaceRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Template installation rejects unknown template identifiers without creating output",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-unknown-template-"
        )
      );

    try {
      await assert.rejects(
        () =>
          installProject(
            "missing-template",
            "should-not-exist",
            {
              projectCreation: {
                workspaceRoot,
              },
            }
          ),
        /Template 'missing-template' not found/
      );

      assert.equal(
        await exists(
          join(
            workspaceRoot,
            "should-not-exist"
          )
        ),
        false
      );
    } finally {
      await rm(
        workspaceRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
