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
  discoverTemplates,
} from "../../dist/services/discovery.js";

import {
  createProject,
} from "../../dist/services/project.js";

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

function createConfig(
  projectName
) {
  return {
    projectName,
    framework: "nextjs",
    language: "typescript",
    packageManager: "npm",
    installDependencies: false,
    initializeGit: false,
  };
}

test(
  "Project templates are discovered independently of the working directory",
  async () => {
    const temporaryDirectory =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-template-discovery-"
        )
      );

    const previousDirectory =
      process.cwd();

    try {
      process.chdir(
        temporaryDirectory
      );

      assert.deepEqual(
        await discoverTemplates(),
        [
          "nextjs",
        ]
      );
    } finally {
      process.chdir(
        previousDirectory
      );

      await rm(
        temporaryDirectory,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Project creation uses Aurora templates in an external workspace",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-project-workspace-"
        )
      );

    const projectName =
      "external-project";

    const projectPath =
      join(
        workspaceRoot,
        projectName
      );

    try {
      await createProject(
        createConfig(
          projectName
        ),
        {
          workspaceRoot,
        }
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

      assert.equal(
        packageJson.dependencies.react,
        "latest"
      );

      assert.equal(
        await exists(
          join(
            projectPath,
            `${projectName}.txt`
          )
        ),
        true
      );

      assert.equal(
        await exists(
          join(
            projectPath,
            "template.json"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectPath,
            "aurora.config.json"
          )
        ),
        true
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
  "Project creation rejects unsafe project names",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-unsafe-project-"
        )
      );

    const escapedPath =
      join(
        workspaceRoot,
        "..",
        "escaped-project"
      );

    try {
      await assert.rejects(
        createProject(
          createConfig(
            "../escaped-project"
          ),
          {
            workspaceRoot,
          }
        ),
        /Invalid project name/
      );

      assert.equal(
        await exists(
          escapedPath
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

test(
  "Project creation removes partial output when template validation fails",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-project-rollback-"
        )
      );

    const templateRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-invalid-template-"
        )
      );

    const nextTemplate =
      join(
        templateRoot,
        "nextjs"
      );

    const projectName =
      "failed-project";

    const projectPath =
      join(
        workspaceRoot,
        projectName
      );

    await mkdir(
      nextTemplate,
      {
        recursive: true,
      }
    );

    await writeFile(
      join(
        nextTemplate,
        "template.json"
      ),
      JSON.stringify(
        {
          id: "nextjs",
          name: "Invalid Next.js",
          displayName:
            "Invalid Next.js",
          version: "1.0.0",
          description:
            "Missing package file",
          author: "Aurora",
          framework: "nextjs",
          language: [
            "typescript",
          ],
          packageManagers: [
            "npm",
          ],
          tags: [],
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      await assert.rejects(
        createProject(
          createConfig(
            projectName
          ),
          {
            workspaceRoot,
            templateRoot,
          }
        ),
        /missing required file: package.json/
      );

      assert.equal(
        await exists(
          projectPath
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

      await rm(
        templateRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
