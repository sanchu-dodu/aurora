import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, symlink, link, realpath, chmod } from "node:fs/promises";
import { join, relative, sep, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectProject } from "../../dist/projects/index.js";
import { collectDoctorReport } from "../../dist/services/doctor.js";
import { serializeLifecycleJournalEnvelope } from "../../dist/packages/lifecycle/lifecycleJournalSchema.js";
import { calculateOfficialRegistryLockEntryDigest } from "../../dist/packages/lock/lockSchema.js";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const manifest = {
  projectName: "sample", framework: "nextjs", language: "typescript",
  packageManager: "npm", installDependencies: false, initializeGit: false,
};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aurora-inspection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function json(root, file, value) {
  const target = join(root, file);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, JSON.stringify(value));
}
function check(report, id) { return report.diagnostics.find(item => item.id === id); }
function cliRun(root, args) {
  return spawnSync(process.execPath, [cli, ...args, "--project", root], {
    cwd: root, encoding: "utf8", windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0" }, timeout: 30000,
  });
}
function receipt(version = "1.0.0") {
  return {
    id: "auth", version, publisherId: "aurora", artifactSha256: "a".repeat(64),
    installedAt: "2026-09-30T00:00:00.000Z", files: [], dependencies: [], environment: [],
  };
}

test("empty directory inspection is deterministic and creates no project state", async t => {
  const root = await fixture(t);
  const report = inspectProject(root);
  assert.equal(report.kind, "directory");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.healthy, true);
  assert.deepEqual(report, inspectProject(root));
  assert.deepEqual(await readdir(root), []);
});

test("shared project model describes existing project metadata without leaking scripts or dependency URLs", async t => {
  const root = await fixture(t);
  await json(root, "aurora.config.json", manifest);
  await json(root, "package.json", {
    name: "sample", engines: { node: ">=22.15.0" },
    dependencies: { zebra: "https://user:private-value@example.com/a", alpha: "^1.0.0" },
    scripts: { dev: "echo private-script-value", "release:check": "exit 99" }, custom: { secret: "private-custom-value" },
  });
  await json(root, ".aurora/features.json", { installed: ["database", "auth"] });
  const before = await readFile(join(root, "package.json"));
  const report = inspectProject(root);
  assert.equal(report.kind, "aurora");
  assert.deepEqual(report.node.dependencies.runtime, ["alpha", "zebra"]);
  assert.deepEqual(report.node.scripts, ["dev", "release:check"]);
  assert.deepEqual(report.features, ["auth", "database"]);
  assert.doesNotMatch(JSON.stringify(report), /private-value|private-script-value|private-custom-value/);
  assert.deepEqual(await readFile(join(root, "package.json")), before);
});

for (const [name, content] of [
  ["malformed", '{"password":"private-value",'],
  ["duplicate keys", '{"name":"sample","name":"second"}'],
  ["scalar", "null"],
  ["oversized", " ".repeat(1024 * 1024 + 1)],
]) {
  test(`inspection fails closed for ${name} metadata without echoing input`, async t => {
    const root = await fixture(t);
    await writeFile(join(root, "package.json"), content);
    const report = inspectProject(root);
    assert.equal(report.healthy, false);
    assert.equal(check(report, "project.node").status, "fail");
    assert.doesNotMatch(JSON.stringify(report), /private-value/);
  });
}

test("malformed optional metadata is not silently treated as empty", async t => {
  const root = await fixture(t);
  await json(root, ".aurora/features.json", { installed: [12] });
  await json(root, ".aurora/config.json", { password: "private-value" });
  await json(root, ".aurora/package-state.json", { packages: {} });
  assert.equal(check(inspectProject(root), "project.features").status, "fail");
  assert.equal(check(inspectProject(root), "project.config").status, "fail");
  assert.equal(check(inspectProject(root), "project.packages").status, "fail");
  assert.doesNotMatch(JSON.stringify(inspectProject(root)), /private-value/);
});

test("symlinked metadata directory is rejected without reading outside the root", async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await json(outside, "features.json", { installed: ["outside"] });
  await symlink(outside, join(root, ".aurora"), process.platform === "win32" ? "junction" : "dir");
  const report = inspectProject(root);
  assert.equal(report.healthy, false);
  assert.deepEqual(report.features, []);
  assert.equal(check(report, "project.transactions").status, "fail");
});

test("hard-linked metadata and directory masquerading as file are rejected", async t => {
  const root = await fixture(t);
  await json(root, "source.json", { name: "sample" });
  await link(join(root, "source.json"), join(root, "package.json"));
  await mkdir(join(root, "aurora.config.json"));
  const report = inspectProject(root);
  assert.equal(check(report, "project.node").status, "fail");
  assert.equal(check(report, "project.manifest").status, "fail");
});

test("package-manager selection honors the project and detects conflicting declarations/lockfiles", async t => {
  const root = await fixture(t);
  await json(root, "aurora.config.json", { ...manifest, packageManager: "pnpm" });
  await json(root, "package.json", { packageManager: "npm@11.0.0" });
  await json(root, "package-lock.json", {});
  const report = inspectProject(root);
  assert.equal(report.packageManager, "pnpm");
  assert.equal(check(report, "project.package-manager-conflict").status, "fail");
  assert.equal(check(report, "project.dependency-lock").status, "warn");
});

test("invalid manager declarations never select arbitrary executables", async t => {
  const root = await fixture(t);
  await json(root, "package.json", { packageManager: "evil@1.0.0" });
  const report = inspectProject(root);
  assert.equal(report.packageManager, "npm");
  assert.equal(check(report, "project.package-manager").status, "fail");
});

test("existing legacy receipts and lockfiles are compared without a verification claim", async t => {
  const root = await fixture(t);
  await json(root, ".aurora/package-state.json", { schemaVersion: 1, packages: { auth: receipt() } });
  await json(root, "aurora.lock", { packages: { auth: "1.0.0" } });
  let report = inspectProject(root);
  assert.equal(check(report, "project.package-consistency").status, "pass");
  assert.deepEqual(report.installedPackages, [{ id: "auth", version: "1.0.0" }]);
  await json(root, "aurora.lock", { packages: { auth: "2.0.0" } });
  report = inspectProject(root);
  assert.equal(report.healthy, false);
  assert.equal(check(report, "project.package-consistency").status, "fail");
});

test("official receipt cannot be downgraded to a legacy lock of the same version", async t => {
  const root = await fixture(t);
  await json(root, ".aurora/package-state.json", {
    schemaVersion: 1, packages: { auth: { ...receipt(), officialLockSha256: "b".repeat(64) } },
  });
  await json(root, "aurora.lock", { packages: { auth: "1.0.0" } });
  assert.equal(check(inspectProject(root), "project.package-consistency").status, "fail");
});

test("official locks require exact receipt binding, publisher, and artifact identity", async t => {
  const root = await fixture(t);
  const entry = {
    lockVersion: 1, source: "official-registry", packageId: "auth", version: "1.0.0",
    registry: { sequence: 1, digest: "b".repeat(64) },
    manifest: { algorithm: "sha256", digest: "c".repeat(64) },
    archive: { algorithm: "sha256", digest: "d".repeat(64), size: 20, url: "https://example.com/auth.tar.gz" },
    provenance: { type: "source", url: "https://example.com/source", reference: "v1" },
    publisher: { id: "aurora", signatureKeyId: null },
    packageArtifact: { algorithm: "sha256", digest: "a".repeat(64) },
  };
  await json(root, "aurora.lock", { packages: { auth: entry } });
  const original = { ...receipt(), officialLockSha256: calculateOfficialRegistryLockEntryDigest(entry) };
  await json(root, ".aurora/package-state.json", { schemaVersion: 1, packages: { auth: original } });
  assert.equal(check(inspectProject(root), "project.package-consistency").status, "pass");
  for (const change of [
    { officialLockSha256: "e".repeat(64) }, { publisherId: "other" }, { artifactSha256: "f".repeat(64) },
  ]) {
    await json(root, ".aurora/package-state.json", { schemaVersion: 1, packages: { auth: { ...original, ...change } } });
    assert.equal(check(inspectProject(root), "project.package-consistency").status, "fail");
  }
});

test("inspection does not search parents and returned data cannot mutate stored state", async t => {
  const root = await fixture(t);
  await json(root, "aurora.config.json", manifest);
  await mkdir(join(root, "child"));
  assert.equal(inspectProject(join(root, "child")).kind, "directory");
  inspectProject(root).project.projectName = "modified";
  assert.equal(inspectProject(root).project.projectName, "sample");
});

test("journal directory inspection is bounded and preserves all entries", async t => {
  const root = await fixture(t);
  const directory = join(root, ".aurora", "lifecycle-journal");
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < 129; index++) await mkdir(join(directory, randomUUID()));
  assert.equal(check(inspectProject(root), "project.transactions").status, "fail");
  assert.equal((await readdir(directory)).length, 129);
});

test("locked packages without receipts are explicitly reported as uninstalled", async t => {
  const root = await fixture(t);
  await json(root, "aurora.lock", { packages: { auth: "1.0.0" } });
  assert.equal(check(inspectProject(root), "project.uninstalled-lock").status, "warn");
});

test("unfinished journal is reported without reading before-images or recovering anything", async t => {
  const root = await fixture(t);
  const id = randomUUID();
  const dir = join(root, ".aurora", "lifecycle-journal", id);
  await mkdir(dir, { recursive: true });
  const journal = {
    schemaVersion: 1, transactionId: id,
    projectRootSha256: createHash("sha256").update(await realpath(root)).digest("hex"),
    operation: "install", packageIds: ["auth"], phase: "prepared",
    createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z",
    files: [], directories: [],
  };
  await writeFile(join(dir, "journal.json"), serializeLifecycleJournalEnvelope(journal));
  const report = inspectProject(root);
  assert.equal(report.pendingTransactions, 1);
  assert.equal(check(report, "project.transactions").status, "warn");
  assert.deepEqual(await readdir(dir), ["journal.json"]);
  await writeFile(join(dir, "journal.json"), "{}");
  assert.equal(inspectProject(root).pendingTransactions, null);
  assert.equal(check(inspectProject(root), "project.transactions").status, "fail");
});

test("doctor checks selected manager, runtime requirements, and strict warning policy", async t => {
  const root = await fixture(t);
  await json(root, "package.json", { name: "sample", packageManager: "pnpm@10.0.0", engines: { node: ">=24.0.0" } });
  const commands = [];
  const probe = async command => { commands.push(command.command); return true; };
  const report = await collectDoctorReport({ projectRoot: root, nodeVersion: "22.15.0" }, probe);
  assert.deepEqual(commands, ["git", "node", "pnpm"]);
  assert.equal(report.healthy, false);
  assert.equal(report.checks.find(c => c.id === "runtime.node").status, "pass");
  assert.equal(report.checks.find(c => c.id === "runtime.project-node").status, "fail");
  const healthy = await collectDoctorReport({ projectRoot: root, nodeVersion: "24.0.0" }, probe);
  assert.equal(healthy.healthy, true);
  assert.equal((await collectDoctorReport({ projectRoot: root, nodeVersion: "24.0.0", strict: true }, probe)).healthy, false);
});

test("doctor reports tool failures and unsupported range syntax without leaking errors", async t => {
  const root = await fixture(t);
  await json(root, "package.json", { engines: { node: "22.x" } });
  const report = await collectDoctorReport({ projectRoot: root, nodeVersion: "20.0.0" }, async () => {
    throw new Error("private-tool-error");
  });
  assert.equal(report.checks.filter(c => c.id.startsWith("tool.") && c.status === "fail").length, 3);
  assert.equal(report.checks.find(c => c.id === "runtime.node").status, "fail");
  assert.equal(report.checks.find(c => c.id === "runtime.project-node").status, "warn");
  assert.doesNotMatch(JSON.stringify(report), /private-tool-error/);
});

test("doctor probes managers outside project ancestors and removes its private directory on errors", async t => {
  const root = await fixture(t);
  await json(root, "package.json", { packageManager: "yarn@4.0.0" });
  await writeFile(join(root, ".yarnrc.yml"), "plugins:\n  - path: ./project-plugin.cjs\n");
  await writeFile(join(root, "project-plugin.cjs"), "throw new Error('PROJECT_MANAGER_PLUGIN_EXECUTED');");
  const requests = [];
  const report = await collectDoctorReport({ projectRoot: root }, undefined, async request => {
    requests.push({ request, cwd: await realpath(request.cwd), entries: await readdir(request.cwd) });
    if (request.command === "yarn") throw new Error("private-tool-error");
    return { command: request.command, exitCode: 0, signal: null, stdout: "", stderr: "" };
  });
  assert.equal(requests.length, 3);
  const canonicalRoot = await realpath(root);
  for (const observation of requests) {
    const rel = relative(canonicalRoot, observation.cwd);
    assert.ok(rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel));
    assert.deepEqual(observation.entries, []);
    let current = observation.cwd;
    while (dirname(current) !== current) {
      assert.notEqual(current, canonicalRoot);
      current = dirname(current);
    }
    assert.equal(observation.request.environment.COREPACK_ENABLE_NETWORK, "0");
    assert.equal(observation.request.environment.YARN_IGNORE_PATH, "1");
    assert.equal(observation.request.excludedExecutableRoot, canonicalRoot);
  }
  assert.equal(new Set(requests.map(observation => observation.cwd)).size, 1);
  await assert.rejects(readdir(requests[0].cwd), { code: "ENOENT" });
  assert.equal(report.checks.find(c => c.id === "tool.git").status, "pass");
  assert.equal(report.checks.find(c => c.id === "tool.node").status, "pass");
  assert.equal(report.checks.find(c => c.id === "tool.yarn").status, "fail");
  assert.doesNotMatch(JSON.stringify(report), /PROJECT_MANAGER_PLUGIN_EXECUTED|private-tool-error/);
});

test("doctor does not run tool probes when system temp is inside the selected root", async () => {
  let invoked = false;
  const report = await collectDoctorReport({ projectRoot: await realpath(tmpdir()) }, undefined, async () => {
    invoked = true;
    throw new Error("Unexpected probe");
  });
  assert.equal(invoked, false);
  assert.equal(report.healthy, false);
  assert.equal(report.checks.find(c => c.id === "tool.probe-isolation").status, "fail");
});

test("doctor CLI cannot execute project-local tool shims from an npm-style PATH", async t => {
  const root = await fixture(t);
  await json(root, "package.json", { name: "sample", packageManager: "pnpm@10.0.0" });
  const bins = join(root, "node_modules", ".bin");
  await mkdir(bins, { recursive: true });
  const markers = [];
  for (const command of ["git", "npm", "pnpm"]) {
    const marker = join(root, `${command}-probe-executed.txt`);
    markers.push(marker);
    const content = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\nprocess.stdout.write("1.0.0\\n");\n`;
    if (process.platform === "win32") {
      const script = join(bins, `${command}-entry.cjs`);
      await writeFile(script, content);
      await writeFile(join(bins, `${command}.cmd`), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    } else {
      const executable = join(bins, command);
      await writeFile(executable, `#!${process.execPath}\n${content}`);
      await chmod(executable, 0o700);
    }
  }
  const env = { ...process.env, PATH: bins, FORCE_COLOR: "0" };
  delete env.NO_COLOR;
  // Windows environment names are case-insensitive: do not retain another PATH spelling.
  for (const name of Object.keys(env)) if (name !== "PATH" && name.toUpperCase() === "PATH") delete env[name];
  const result = spawnSync(process.execPath, [cli, "doctor", "--project", root, "--json"], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.find(c => c.id === "tool.git").status, "fail");
  assert.equal(report.checks.find(c => c.id === "tool.node").status, "pass");
  assert.equal(report.checks.find(c => c.id === "tool.pnpm").status, "fail");
  for (const marker of markers) await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("CLI JSON inspection is clean, does not activate project code, and returns failure for invalid metadata", async t => {
  const root = await fixture(t);
  await json(root, "package.json", { name: "sample", scripts: { preinstall: "exit 99" } });
  await mkdir(join(root, "plugins"));
  await writeFile(join(root, "plugins", "tripwire.js"), "throw new Error('PROJECT_EXECUTED');");
  let result = cliRun(root, ["project", "inspect", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).node.name, "sample");
  assert.doesNotMatch(result.stdout + result.stderr, /PROJECT_EXECUTED|Aurora Runtime/);
  await writeFile(join(root, "package.json"), '{"secret":"private-value",');
  result = cliRun(root, ["project", "inspect", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).healthy, false);
  assert.match(result.stderr, /PROJECT_INSPECTION_FAILED/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-value/);
});

test("doctor CLI emits parseable failure JSON and honors quiet output", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "aurora.config.json"), "{}");
  const result = cliRun(root, ["doctor", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).healthy, false);
  assert.match(result.stderr, /DOCTOR_CHECK_FAILED/);
  const quiet = cliRun(root, ["project", "inspect", "--json", "--quiet"]);
  assert.equal(quiet.status, 1);
  assert.equal(quiet.stdout, "");
  assert.match(quiet.stderr, /PROJECT_INSPECTION_FAILED/);
});
