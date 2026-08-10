import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
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

                await writeFile(
                  join(
                    receivedProjectPath,
                    "package-lock.json"
                  ),
                  "{}\n",
                  "utf8"
                );
              },

              async gitInitializer(
                receivedProjectPath,
                generatedFiles
              ) {
                operations.push({
                  type: "git",
                  projectPath:
                    receivedProjectPath,
                  generatedFiles:
                    [
                      ...generatedFiles,
                    ].sort(),
                });
              },
            },
          }
        );

      assert.equal(
        installed,
        true
      );

      const canonicalProjectPath =
        await realpath(projectPath);

      assert.deepEqual(
        operations,
        [
          {
            type:
              "dependencies",
            projectPath:
              canonicalProjectPath,
            packageManager: "npm",
          },
          {
            type: "git",
            projectPath:
              canonicalProjectPath,
            generatedFiles: [
              ".gitignore",
              "app\\page.tsx",
              "aurora.config.json",
              "installed-template.txt",
              "next-env.d.ts",
              "package-lock.json",
              "package.json",
              "README.md",
              "tsconfig.json",
            ].map(
              relativePath =>
                relativePath.replaceAll(
                  "\\",
                  process.platform ===
                    "win32"
                    ? "\\"
                    : "/"
                )
            ).sort(),
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
