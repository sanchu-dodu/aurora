import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

async function workspace(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-init-preview-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runWizard(cwd, config) {
  const prompts = [
    ["What is your project name?", config.name + "\r"],
    ["Select a framework", "\r"],
    ["Select a language", "\r"],
    ["Select a package manager", "\r"],
    ["Install dependencies?", config.dependencies ? "y\r" : "n\r"],
    ["Initialize Git repository?", config.git ? "y\r" : "n\r"],
  ];
  const env = { ...process.env, FORCE_COLOR: "0", npm_config_offline: "true" };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH" || key === "NO_COLOR") delete env[key];
  }
  // Even a broken preview may not invoke the user's npm or Git installation.
  env.PATH = cwd;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "init", "--no-color", ...(config.dryRun ? ["--dry-run"] : [])], {
      cwd, env, windowsHide: true, timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
    });
    let rawStdout = "";
    let stderr = "";
    let answered = 0;
    let searchStart = 0;
    child.stdout.setEncoding("utf8").on("data", chunk => {
      rawStdout += chunk;
      const prompt = prompts[answered];
      const stdout = stripVTControlCharacters(rawStdout);
      if (!prompt) return;
      const index = stdout.indexOf(prompt[0], searchStart);
      if (index === -1) return;
      searchStart = index + prompt[0].length;
      answered++;
      child.stdin.write(prompt[1]);
    });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.stdin.once("error", reject);
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ code, signal, answered, stdout: stripVTControlCharacters(rawStdout), stderr }));
  });
}

async function listFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(root, entry.name), relative + "/"));
    else files.push(relative);
  }
  return files.sort();
}

test("wizard dry run previews selected dependency and Git steps without running them", async t => {
  const root = await workspace(t);
  const name = "wizard-preview";
  const preview = await runWizard(root, { name, dryRun: true, dependencies: true, git: true });
  assert.equal(preview.code, 0, JSON.stringify(preview));
  assert.equal(preview.answered, 6);
  assert.equal(preview.stderr, "");
  assert.ok(preview.stdout.includes(`Destination      : ${join(root, name)}`));
  assert.match(preview.stdout, /Install Dependencies : Yes/u);
  assert.match(preview.stdout, /Initialize Git +: Yes/u);
  assert.match(preview.stdout, /Dry run complete/u);
  assert.doesNotMatch(preview.stdout, /initialized successfully|Aurora Runtime|plugin activated/iu);
  assert.deepEqual(await readdir(root), []);

  const created = await runWizard(root, { name, dependencies: false, git: false });
  assert.equal(created.code, 0, JSON.stringify(created));
  assert.equal(created.answered, 6);
  assert.match(created.stdout, /initialized successfully/u);
  const inventory = preview.stdout.split("Starter files (before dependency installation or Git setup):")[1];
  assert.ok(inventory);
  const files = Array.from(inventory.matchAll(/^  (.+)$/gmu), match => match[1].trim());
  assert.ok(files.includes("aurora.config.json"));
  assert.deepEqual(await listFiles(join(root, name)), files);
});

test("wizard preview rejects an occupied destination and preserves its files", async t => {
  const root = await workspace(t);
  await mkdir(join(root, "existing"));
  await writeFile(join(root, "existing", "keep.txt"), "keep me");
  const preview = await runWizard(root, { name: "existing", dryRun: true, dependencies: true, git: true });
  assert.equal(preview.code, 1, JSON.stringify(preview));
  assert.equal(preview.answered, 6);
  assert.match(preview.stderr, /already exists/u);
  assert.doesNotMatch(preview.stdout, /Dry run complete|initialized successfully/u);
  assert.deepEqual(await listFiles(root), ["existing/keep.txt"]);
  assert.equal(await readFile(join(root, "existing", "keep.txt"), "utf8"), "keep me");
});
