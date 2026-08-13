import test from "node:test";
import assert from "node:assert/strict";

import {
  exec,
} from "node:child_process";

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

import {
  fileURLToPath,
} from "node:url";

import {
  promisify,
} from "node:util";

import "../../dist/templates/registerNext.js";

import {
  createProject,
} from "../../dist/services/project.js";

const execAsync =
  promisify(exec);

const cliRoot =
  fileURLToPath(
    new URL(
      "../../",
      import.meta.url
    )
  );

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
  "npm package contains only required production assets",
  async () => {
    const {
      stdout,
    } = await execAsync(
      "npm pack --dry-run --json --ignore-scripts",
      {
        cwd: cliRoot,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer:
          10 * 1024 * 1024,
      }
    );

    const results =
      JSON.parse(stdout);

    const pack =
      Array.isArray(results)
        ? results[0]
        : results;

    const paths =
      pack.files.map(
        (file) =>
          file.path.replaceAll(
            "\\",
            "/"
          )
      );

    const requiredPaths = [
      "dist/index.js",
      "dist/plugins/helloPlugin.js",
      "packages/auth/manifest.json",
      "packages/auth/install.js",
      "templates/generators/react/component.json",
      "templates/generators/react/component.tsx.template",
      "templates/projects/nextjs/gitignore.template",
      "templates/projects/nextjs/package.json",
      "templates/projects/nextjs/template.json",
      "docs/package-manifest-v1.md",
      "docs/extension-worker-v1.md",
      "dist/plugins/helloExtension.js",
      "dist/plugins/helloExtension.manifest.json",
      "dist/runtime/extensions/extensionWorkerHost.js",
      "dist/runtime/extensions/extensionWorkerRuntime.js",
      "package.json",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
    ];

    for (
      const requiredPath
      of requiredPaths
    ) {
      assert.ok(
        paths.includes(
          requiredPath
        ),
        `Missing packaged path: ${requiredPath}`
      );
    }

    const forbiddenPrefixes = [
      "src/",
      "tests/",
      "AuroraCore/",
      "AuroraGalaxy/",
      "AuroraOS/",
      "AuroraStudio/",
      "AuroraTest/",
      ".aurora/",
    ];

    for (
      const forbiddenPrefix
      of forbiddenPrefixes
    ) {
      assert.equal(
        paths.some(
          (packagedPath) =>
            packagedPath.startsWith(
              forbiddenPrefix
            )
        ),
        false,
        `Unexpected packaged prefix: ${forbiddenPrefix}`
      );
    }

    const forbiddenPaths = [
      ".env.example",
      "aurora.lock",
      "tsconfig.json",
      "npm-package-audit.txt",
      "package-followup-audit.txt",
      "templates/projects/nextjs/.gitignore",
    ];

    for (
      const forbiddenPath
      of forbiddenPaths
    ) {
      assert.equal(
        paths.includes(
          forbiddenPath
        ),
        false,
        `Unexpected packaged path: ${forbiddenPath}`
      );
    }
  }
);

test(
  "npm package configuration exposes a built executable",
  async () => {
    const packageJson =
      JSON.parse(
        await readFile(
          join(
            cliRoot,
            "package.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      packageJson.bin.aurora,
      "dist/index.js"
    );

    assert.deepEqual(
      packageJson.files,
      [
        "dist",
        "packages",
        "templates",
        "docs",
        "README.md",
        "LICENSE",
        "CHANGELOG.md",
      ]
    );

    assert.equal(
      packageJson.scripts.prepack,
      "npm run build"
    );

    const compiledEntry =
      await readFile(
        join(
          cliRoot,
          "dist",
          "index.js"
        ),
        "utf8"
      );

    assert.ok(
      compiledEntry.startsWith(
        "#!/usr/bin/env node"
      )
    );
  }
);

test(
  "package-safe gitignore template becomes a project gitignore",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-gitignore-template-"
        )
      );

    try {
      const projectPath =
        await createProject(
          {
            projectName:
              "gitignore-project",
            framework:
              "nextjs",
            language:
              "typescript",
            packageManager:
              "npm",
            installDependencies:
              false,
            initializeGit:
              false,
          },
          {
            workspaceRoot,
          }
        );

      assert.equal(
        await exists(
          join(
            projectPath,
            ".gitignore"
          )
        ),
        true
      );

      assert.equal(
        await exists(
          join(
            projectPath,
            "gitignore.template"
          )
        ),
        false
      );

      const generatedGitignore =
        await readFile(
          join(
            projectPath,
            ".gitignore"
          ),
          "utf8"
        );

      const sourceGitignore =
        await readFile(
          join(
            cliRoot,
            "templates",
            "projects",
            "nextjs",
            "gitignore.template"
          ),
          "utf8"
        );

      assert.equal(
        generatedGitignore,
        sourceGitignore
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
