import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
import "../../dist/commands/templateRegistration.js";
import { runCli } from "../../dist/cli.js";

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

const cliEntry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

function cliRun(cwd, args) {
  const env = { ...process.env, FORCE_COLOR: "0" };
  delete env.NO_COLOR;
  return spawnSync(process.execPath, [cliEntry, "template", "install", ...args], {
    cwd, env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
}

async function filesIn(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relativePath = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(join(root, entry.name), relativePath + "/"));
    else files.push(relativePath);
  }
  return files.sort();
}

test("template install dry-run previews exactly the files of a subsequent JSON install", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-template-preview-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "selected workspace");
  await mkdir(workspace);
  const args = ["nextjs", "sample", "--workspace", workspace, "--json"];
  const dryRun = cliRun(root, [...args, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryRun.stderr, "");
  const preview = JSON.parse(dryRun.stdout);
  assert.equal(preview.schemaVersion, 1);
  assert.deepEqual(preview.template, { id: "nextjs", version: "1.1.0" });
  assert.equal(preview.status, "dry-run");
  assert.equal(preview.root, join(workspace, "sample"));
  assert.equal(preview.packageManager, "npm");
  assert.equal(preview.installDependencies, false);
  assert.equal(preview.initializeGit, false);
  assert.ok(preview.files.includes(".gitignore"));
  assert.ok(preview.files.includes("aurora.config.json"));
  assert.deepEqual(await readdir(workspace), []);
  assert.deepEqual(await readdir(root), ["selected workspace"]);

  const install = cliRun(root, args);
  assert.equal(install.status, 0, install.stderr);
  const { files, ...expected } = preview;
  assert.deepEqual(JSON.parse(install.stdout), { ...expected, status: "created" });
  assert.deepEqual(await filesIn(preview.root), files);
});

test("invalid template previews fail without changing an existing workspace", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-template-preview-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "existing"));
  await writeFile(join(root, "existing", "keep.txt"), "keep me");
  for (const [args, error] of [
    [["missing", "sample"], /TEMPLATE_NOT_FOUND/u],
    [["nextjs", "existing"], /already exists/u],
    [["nextjs", "../outside"], /Invalid project name/u],
    [["nextjs", "sample", "--workspace", "missing"], /UNSAFE_PROJECT_PATH/u],
  ]) {
    const result = cliRun(root, [...args, "--dry-run", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, error);
    assert.deepEqual(await readdir(root), ["existing"]);
    assert.deepEqual(await filesIn(root), ["existing/keep.txt"]);
    assert.equal(await readFile(join(root, "existing", "keep.txt"), "utf8"), "keep me");
  }
});

test("template preview and install do not prepare the package catalog or start the runtime", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-template-preview-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tripwire = {
    async prepareCatalog() { assert.fail("Catalog activation"); },
    async activate() { assert.fail("Runtime activation"); },
    async shutdown() { assert.fail("Runtime shutdown"); },
  };
  const args = ["node", "aurora", "template", "install", "nextjs", "sample", "--workspace", root, "--quiet"];
  await runCli([...args, "--dry-run"], tripwire);
  assert.deepEqual(await readdir(root), []);
  await runCli(args, tripwire);
  assert.ok((await filesIn(join(root, "sample"))).includes("package.json"));
});

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
              "app\\layout.tsx",
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
        "16.4.6"
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
