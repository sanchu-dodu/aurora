import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fsExtra from "fs-extra";
import { createHash, randomUUID } from "node:crypto";
import { createSolution, getSolutionPack, listSolutionPacks, parseSolutionState, planCapability } from "../../dist/solutions/index.js";
import { inspectProject } from "../../dist/projects/index.js";
import { createProject } from "../../dist/services/project.js";
import { OperationPlanService, sha256 } from "../../dist/operations/operationPlanService.js";
import { serializeLifecycleJournalEnvelope } from "../../dist/packages/lifecycle/lifecycleJournalSchema.js";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const statePath = ".aurora/solution.json";
const routePath = "app/api/health/route.ts";
async function workspace(t) {
  // Match runtime path identity, including Windows short-name/casing aliases.
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-solutions-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t) {
  const parent = await workspace(t);
  const result = await createSolution("web-app", "sample", { workspaceRoot: parent });
  return { parent, root: result.root, state: result.solution };
}
async function snapshot(root) {
  const files = {};
  async function visit(dir, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(dir, entry.name), `${relative}/`);
      else files[relative] = (await readFile(join(dir, entry.name))).toString("base64");
    }
  }
  await visit(root);
  return files;
}
function cliRun(cwd, args) {
  const env = { ...process.env, FORCE_COLOR: "0" };
  delete env.NO_COLOR;
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
}
async function saveState(root, state) { await writeFile(join(root, statePath), JSON.stringify(state)); }

test("bundled catalog is detached and versioned", () => {
  const pack = getSolutionPack("web-app");
  assert.equal(pack.version, "1.0.0");
  assert.deepEqual(pack.template, { id: "nextjs", version: "1.1.0" });
  pack.capabilities[0].id = "tampered";
  assert.equal(listSolutionPacks()[0].capabilities[0].id, "health");
  assert.throws(() => getSolutionPack("external"), { code: "SOLUTION_NOT_SUPPORTED" });
});

test("silent offline creation records starter identity without install or Git", async t => {
  const parent = await workspace(t);
  const messages = [];
  const log = console.log;
  let created;
  console.log = (...values) => messages.push(values);
  try { created = await createSolution("web-app", "sample", { workspaceRoot: parent }); }
  finally { console.log = log; }
  assert.deepEqual(messages, []);
  assert.deepEqual(inspectProject(created.root).solution, created.solution);
  assert.equal(inspectProject(created.root).healthy, true);
  const files = await snapshot(created.root);
  assert.ok(files["app/layout.tsx"]);
  assert.ok(files["app/page.tsx"]);
  assert.ok(files[statePath]);
  assert.equal(files[routePath], undefined);
  const entries = await readdir(created.root);
  for (const forbidden of ["node_modules", ".git", "package-lock.json"]) assert.equal(entries.includes(forbidden), false);
});

for (const [name, manager] of [["../escape", "npm"], ["BadName", "npm"], ["con", "npm"], ["valid", "unknown"]]) {
  test(`creation rejects unsafe or unsupported input ${name}/${manager} without output`, async t => {
    const parent = await workspace(t);
    await assert.rejects(createSolution("web-app", name, { workspaceRoot: parent, packageManager: manager }));
    assert.deepEqual(await readdir(parent), []);
  });
}

test("creation never replaces an existing directory and concurrent creation has one winner", async t => {
  const parent = await workspace(t);
  await mkdir(join(parent, "existing"));
  await writeFile(join(parent, "existing", "mine.txt"), "keep me");
  await assert.rejects(createSolution("web-app", "existing", { workspaceRoot: parent }));
  assert.equal(await readFile(join(parent, "existing", "mine.txt"), "utf8"), "keep me");
  const outcomes = await Promise.allSettled([
    createSolution("web-app", "racing", { workspaceRoot: parent }),
    createSolution("web-app", "racing", { workspaceRoot: parent }),
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(inspectProject(join(parent, "racing")).solution.solution.id, "web-app");
});

test("extra starter metadata cannot overwrite generated files and failure removes only new output", async t => {
  const parent = await workspace(t);
  await assert.rejects(createProject({ projectName: "failed", framework: "nextjs", language: "typescript",
    packageManager: "npm", installDependencies: false, initializeGit: false }, {
    workspaceRoot: parent, silent: true,
    additionalFiles: [{ relativePath: "package.json", content: "overwrite" }],
  }));
  assert.deepEqual(await readdir(parent), []);
});

test("failed creation does not remove a replacement directory", async t => {
  const parent = await workspace(t);
  const target = join(parent, "sample");
  await assert.rejects(createProject({ projectName: "sample", framework: "nextjs", language: "typescript",
    packageManager: "npm", installDependencies: true, initializeGit: false }, {
    workspaceRoot: parent, silent: true,
    dependencyInstaller: async () => {
      await rename(target, join(parent, "original"));
      await mkdir(target);
      await writeFile(join(target, "mine.txt"), "preserve replacement");
      throw new Error("injected failure");
    },
  }), { name: "AggregateError" });
  assert.equal(await readFile(join(target, "mine.txt"), "utf8"), "preserve replacement");
  assert.ok((await snapshot(join(parent, "original")))["app/page.tsx"]);
});

test("failed creation preserves replacement directories whose numeric inode IDs alias", async t => {
  const parent = await workspace(t);
  const target = join(parent, "sample");
  const originalInode = 9007199254740992n;
  const replacementInode = 9007199254740993n;
  assert.equal(Number(originalInode), Number(replacementInode));
  const originalLstat = fsExtra.lstat;
  const identityReads = [];
  let replaced = false;
  fsExtra.lstat = async (...args) => {
    const information = await originalLstat(...args);
    if (String(args[0]) === target) {
      const bigint = args[1]?.bigint === true;
      identityReads.push(bigint);
      information.ino = bigint
        ? (replaced ? replacementInode : originalInode)
        : Number(replaced ? replacementInode : originalInode);
    }
    return information;
  };
  try {
    await assert.rejects(createProject({ projectName: "sample", framework: "nextjs", language: "typescript",
      packageManager: "npm", installDependencies: true, initializeGit: false }, {
      workspaceRoot: parent, silent: true,
      dependencyInstaller: async () => {
        await rename(target, join(parent, "original"));
        await mkdir(target);
        await writeFile(join(target, "mine.txt"), "preserve aliased replacement");
        replaced = true;
        throw new Error("injected failure");
      },
    }), { name: "AggregateError" });
  } finally {
    fsExtra.lstat = originalLstat;
  }
  assert.deepEqual(identityReads, [true, true]);
  assert.equal(await readFile(join(target, "mine.txt"), "utf8"), "preserve aliased replacement");
  assert.ok((await snapshot(join(parent, "original")))["app/page.tsx"]);
});

test("health preview and dry-run make no project changes; apply records only the new capability", async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, "app/page.tsx"), "// my page\nexport default function Page() { return <p>My work</p>; }\n");
  const before = await snapshot(root);
  const service = new OperationPlanService();
  const plan = await planCapability("health", { projectRoot: root, service });
  assert.equal(plan.requiresApproval, true);
  assert.deepEqual(plan.operations.map(operation => operation.path), [routePath, statePath]);
  assert.equal(plan.operations[0].expected.exists, false);
  assert.equal(plan.operations[1].expected.sha256, sha256(await readFile(join(root, statePath))));
  assert.deepEqual(await snapshot(root), before);
  await assert.rejects(service.apply(plan, root, { approved: false }), { code: "OPERATION_APPROVAL_REQUIRED" });
  await service.apply(plan, root, { approved: false, dryRun: true });
  assert.deepEqual(await snapshot(root), before);
  const result = await service.apply(plan, root, { approved: true });
  assert.equal(result.totals.applied, 2);
  const after = await snapshot(root);
  for (const [file, content] of Object.entries(before)) {
    if (file !== statePath) assert.equal(after[file], content, file);
  }
  const state = inspectProject(root).solution;
  assert.equal(state.capabilities[0].id, "health");
  assert.equal(state.capabilities[0].files[0].sha256, sha256(await readFile(join(root, routePath))));
  await assert.rejects(planCapability("health", { projectRoot: root }), { code: "CAPABILITY_PLAN_FAILED" });
  await assert.rejects(service.apply(plan, root, { approved: true }), { code: "OPERATION_PLAN_DRIFT" });
});

for (const path of [routePath, statePath]) {
  test(`edits after preview to ${path} block all writes`, async t => {
    const { root } = await fixture(t);
    const plan = await planCapability("health", { projectRoot: root });
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "my later edit\n");
    const before = await snapshot(root);
    await assert.rejects(new OperationPlanService().apply(plan, root, { approved: true }), { code: "OPERATION_PLAN_DRIFT" });
    assert.deepEqual(await snapshot(root), before);
  });
}

test("existing endpoint directory is never claimed, even when empty", async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, "app/api/health"), { recursive: true });
  const before = await snapshot(root);
  await assert.rejects(planCapability("health", { projectRoot: root }), { code: "CAPABILITY_PLAN_FAILED" });
  assert.deepEqual(await snapshot(root), before);
});

test("junction or symlinked endpoint ancestors cannot escape the project", async t => {
  const { root, parent } = await fixture(t);
  const outside = join(parent, "outside");
  await mkdir(outside);
  await mkdir(join(root, "app/api"));
  await symlink(outside, join(root, "app/api/health"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(planCapability("health", { projectRoot: root }));
  assert.deepEqual(await readdir(outside), []);
});

test("unsupported capability, starter versions, and invalid project metadata fail without mutations", async t => {
  const { root, state } = await fixture(t);
  await assert.rejects(planCapability("payments", { projectRoot: root }), { code: "CAPABILITY_PLAN_FAILED" });
  await saveState(root, { ...state, solution: { id: "web-app", version: "2.0.0" } });
  await assert.rejects(planCapability("health", { projectRoot: root }), { code: "CAPABILITY_PLAN_FAILED" });
  await saveState(root, state);
  await writeFile(join(root, "package.json"), '{"password":"private-value",');
  const before = await snapshot(root);
  await assert.rejects(planCapability("health", { projectRoot: root }), error => {
    assert.doesNotMatch(error.message, /private-value/);
    return error.code === "CAPABILITY_PLAN_FAILED";
  });
  assert.deepEqual(await snapshot(root), before);
});

test("unfinished package lifecycle blocks capability planning without recovery", async t => {
  const { root } = await fixture(t);
  const id = randomUUID();
  const journalDirectory = join(root, ".aurora/lifecycle-journal", id);
  await mkdir(journalDirectory, { recursive: true });
  await writeFile(join(journalDirectory, "journal.json"), serializeLifecycleJournalEnvelope({
    schemaVersion: 1, transactionId: id,
    projectRootSha256: createHash("sha256").update(await realpath(root)).digest("hex"),
    operation: "install", packageIds: ["auth"], phase: "prepared",
    createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z", files: [], directories: [],
  }));
  const before = await snapshot(root);
  await assert.rejects(planCapability("health", { projectRoot: root }), { code: "CAPABILITY_PLAN_FAILED" });
  assert.deepEqual(await snapshot(root), before);
});

test("state change during plan construction cannot be overwritten by stale metadata", async t => {
  const { root, state } = await fixture(t);
  class RacingService extends OperationPlanService {
    async createFileWriteBatchPlan(options) {
      await saveState(root, { ...state, template: { id: "nextjs", version: "9.0.0" } });
      return super.createFileWriteBatchPlan(options);
    }
  }
  await assert.rejects(planCapability("health", { projectRoot: root, service: new RacingService() }), { code: "CAPABILITY_PLAN_FAILED" });
  assert.equal(inspectProject(root).solution.template.version, "9.0.0");
  assert.equal((await snapshot(root))[routePath], undefined);
});

test("strict solution state rejects duplicate identities, overlapping paths and secret-bearing fields", async t => {
  const { state } = await fixture(t);
  const capability = { id: "health", version: "1.0.0", files: [{ path: routePath, sha256: "a".repeat(64) }] };
  for (const value of [
    { ...state, password: "private-value" },
    { ...state, capabilities: [capability, capability] },
    { ...state, capabilities: [{ ...capability, files: [...capability.files, { path: "app/api/health", sha256: "b".repeat(64) }] }] },
    { ...state, capabilities: [{ ...capability, files: [{ path: "../outside", sha256: "a".repeat(64) }] }] },
    { ...state, capabilities: [{ ...capability, files: [{ path: ".aurora/config.json", sha256: "a".repeat(64) }] }] },
  ]) assert.throws(() => parseSolutionState(value), error => {
    assert.doesNotMatch(error.message, /private-value/);
    return error.code === "INVALID_SOLUTION_STATE";
  });
});

test("CLI creation, plan, project selection, dry-run and approved apply work without plugin activation", async t => {
  const parent = await workspace(t);
  const creation = cliRun(parent, ["create", "web-app", "cli-app", "--json"]);
  assert.equal(creation.status, 0, creation.stderr);
  const root = JSON.parse(creation.stdout).root;
  const output = join(parent, "health-plan.json");
  const preview = cliRun(parent, ["capability", "plan", "health", "--project", root, "--out", output, "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).operations.length, 2);
  const before = await snapshot(root);
  const noApproval = cliRun(parent, ["apply", output, "--project", root]);
  assert.equal(noApproval.status, 1);
  assert.match(noApproval.stderr, /OPERATION_APPROVAL_REQUIRED/);
  const dryRun = cliRun(parent, ["apply", output, "--project", root, "--dry-run", "--json"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).status, "dry-run");
  assert.deepEqual(await snapshot(root), before);
  const applied = cliRun(parent, ["apply", output, "--project", root, "--yes", "--json"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).totals.applied, 2);
  for (const result of [creation, preview, dryRun, applied]) assert.doesNotMatch(result.stdout, /plugin activated|Aurora Runtime/iu);
  assert.equal(cliRun(parent, ["solution", "list", "--json", "--quiet"]).stdout, "");
  assert.equal(JSON.parse(cliRun(parent, ["capability", "list", "--json"]).stdout)[0].id, "health");
});
