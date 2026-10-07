import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, readlink, rm, unlink, link, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSolution, inspectCapabilities, planCapability } from "../../dist/solutions/index.js";
import { OperationPlanService } from "../../dist/operations/operationPlanService.js";
import { inspectProject } from "../../dist/projects/index.js";
import { collectDoctorReport } from "../../dist/services/doctor.js";

const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const statePath = ".aurora/solution.json";
const routePath = "app/api/health/route.ts";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, installed = true) {
  const parent = await mkdtemp(join(tmpdir(), "aurora-capability-inspection-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const created = await createSolution("web-app", "sample", { workspaceRoot: parent });
  if (installed) {
    const service = new OperationPlanService();
    const plan = await planCapability("health", { projectRoot: created.root, service });
    await service.apply(plan, created.root, { approved: true });
  }
  return { parent, root: created.root };
}
async function state(root) { return JSON.parse(await readFile(join(root, statePath), "utf8")); }
async function saveState(root, value) { await writeFile(join(root, statePath), JSON.stringify(value)); }
async function snapshot(root) {
  const result = {};
  async function visit(directory, prefix = "") {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix + entry.name;
      const target = join(directory, entry.name);
      if (entry.isSymbolicLink()) result[relative] = { link: await readlink(target) };
      else if (entry.isDirectory()) { result[relative] = { directory: true }; await visit(target, relative + "/"); }
      else if (entry.isFile()) result[relative] = { content: (await readFile(target)).toString("base64") };
      else result[relative] = { special: true };
    }
  }
  await visit(root);
  return result;
}
function onlyFile(report) {
  assert.equal(report.capabilities.length, 1);
  assert.equal(report.capabilities[0].files.length, 1);
  return report.capabilities[0].files[0];
}
function cliRun(root, args = []) {
  const env = { ...process.env, FORCE_COLOR: "0" };
  delete env.NO_COLOR;
  return spawnSync(process.execPath, [cli, "capability", "verify", "--project", root, ...args], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000,
  });
}
function capabilityCheck(report) { return report.checks.find(check => check.id === "project.capability-files.health"); }

function auditedInspection(root, relativePaths, mutateAfterRead = false) {
  const paths = new Set(relativePaths.map(path => join(root, path)));
  const initialSizes = new Map([...paths].map(path => [path, fsSync.statSync(path).size]));
  const originalRead = fsSync.readSync;
  const originalOpen = fsSync.openSync;
  const originalClose = fsSync.closeSync;
  const originalFstat = fsSync.fstatSync;
  const originalLstat = fsSync.lstatSync;
  const openedPaths = new Set();
  const readPaths = new Set();
  const mutatedPaths = new Set();
  const fileBytesRead = new Map();
  const openedDescriptors = new Map();
  const statTraces = new Map();
  function trace(path, operation, information) {
    if (!path) return;
    const observations = statTraces.get(path) ?? [];
    const observation = { operation, size: information.size, dev: information.dev, ino: information.ino,
      nlink: information.nlink, mtimeMs: information.mtimeMs, ctimeMs: information.ctimeMs,
      atimeMs: information.atimeMs, birthtimeMs: information.birthtimeMs };
    observations.push(Object.fromEntries(Object.entries(observation).map(([key, value]) =>
      [key, typeof value === "bigint" ? value.toString() : value])));
    statTraces.set(path, observations);
  }
  let managedBytesRead = 0;
  fsSync.openSync = (...args) => {
    const path = String(args[0]);
    const fd = originalOpen(...args);
    if (paths.has(path)) {
      openedPaths.add(path);
      openedDescriptors.set(fd, path);
    } else openedDescriptors.delete(fd);
    return fd;
  };
  fsSync.lstatSync = (...args) => {
    const information = originalLstat(...args);
    if (paths.has(String(args[0]))) trace(String(args[0]), "lstat", information);
    return information;
  };
  fsSync.closeSync = (...args) => {
    try { return originalClose(...args); }
    finally { openedDescriptors.delete(args[0]); }
  };
  fsSync.fstatSync = (...args) => {
    const information = originalFstat(...args);
    trace(openedDescriptors.get(args[0]), "fstat", information);
    return information;
  };
  fsSync.readSync = (...args) => {
    // Numeric inode values can collide above Number.MAX_SAFE_INTEGER on NTFS.
    // Attribute the read to the descriptor returned for this exact opened path.
    const path = openedDescriptors.get(args[0]);
    const count = originalRead(...args);
    if (path !== undefined) {
      managedBytesRead += count;
      readPaths.add(path);
      const total = (fileBytesRead.get(path) ?? 0) + count;
      fileBytesRead.set(path, total);
      if (mutateAfterRead && count > 0 && total >= initialSizes.get(path) && !mutatedPaths.has(path)) {
        mutatedPaths.add(path);
        // An external writer can make the just-read snapshot unsafe. Its bytes
        // must nevertheless count against the inspection's total I/O budget.
        fsSync.writeFileSync(path, "changed after read\n");
      }
    }
    return count;
  };
  try {
    return { report: inspectCapabilities(root), managedBytesRead, openedPaths, readPaths, mutatedPaths, statTraces };
  } finally {
    fsSync.readSync = originalRead;
    fsSync.openSync = originalOpen;
    fsSync.closeSync = originalClose;
    fsSync.fstatSync = originalFstat;
    fsSync.lstatSync = originalLstat;
  }
}

test("fresh valid starters report zero checked capability files without writes or output", async t => {
  const { root } = await fixture(t, false);
  const before = await snapshot(root);
  const output = [];
  const log = console.log;
  const error = console.error;
  let report;
  console.log = (...values) => output.push(values);
  console.error = (...values) => output.push(values);
  try { report = inspectCapabilities(root); }
  finally { console.log = log; console.error = error; }
  assert.equal(report.then, undefined);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.root, root);
  assert.deepEqual(report.solution, { id: "web-app", version: "1.0.0" });
  assert.equal(report.healthy, true);
  assert.equal(report.clean, true);
  assert.deepEqual(report.capabilities, []);
  assert.deepEqual(output, []);
  assert.deepEqual(inspectCapabilities(root), report);
  assert.deepEqual(await snapshot(root), before);
});

test("installed files match recorded raw digests and returned reports are independent", async t => {
  const { root } = await fixture(t);
  const before = await snapshot(root);
  const report = inspectCapabilities(root);
  const file = onlyFile(report);
  assert.equal(report.healthy, true);
  assert.equal(report.clean, true);
  assert.deepEqual(file, { path: routePath, status: "unchanged",
    expectedSha256: digest(await readFile(join(root, routePath))), actualSha256: digest(await readFile(join(root, routePath))) });
  assert.deepEqual(inspectProject(root).capabilityChecks, report.capabilities);
  file.status = "modified";
  assert.equal(onlyFile(inspectCapabilities(root)).status, "unchanged");
  assert.deepEqual(await snapshot(root), before);
});

test("modified files warn without repair or content disclosure; doctor respects strict mode", async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, routePath), "// PRIVATE_CONTENT_TRIPWIRE\nAuthorization: Bearer private-credential-value\n");
  // Inspector checks presence, not the content or authenticity of this manager lock.
  await writeFile(join(root, "package-lock.json"), "{}\n");
  const before = await snapshot(root);
  const report = inspectCapabilities(root);
  assert.equal(report.healthy, true);
  assert.equal(report.clean, false);
  assert.equal(onlyFile(report).status, "modified");
  assert.notEqual(onlyFile(report).actualSha256, onlyFile(report).expectedSha256);
  assert.equal(report.diagnostics[0].status, "warn");
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_CONTENT_TRIPWIRE|private-credential-value/);
  const normal = await collectDoctorReport({ projectRoot: root, nodeVersion: "26.4.0" }, async () => true);
  assert.equal(normal.healthy, true);
  assert.equal(capabilityCheck(normal).status, "warn");
  const strict = await collectDoctorReport({ projectRoot: root, nodeVersion: "26.4.0", strict: true }, async () => true);
  assert.equal(strict.healthy, false);
  assert.equal(capabilityCheck(strict).status, "warn");
  assert.deepEqual(await snapshot(root), before);
});

test("missing files fail inspection and normal doctor without being recreated", async t => {
  const { root } = await fixture(t);
  await unlink(join(root, routePath));
  const before = await snapshot(root);
  const report = inspectCapabilities(root);
  assert.equal(report.healthy, false);
  assert.equal(report.clean, false);
  assert.equal(onlyFile(report).status, "missing");
  assert.equal(onlyFile(report).actualSha256, undefined);
  const doctor = await collectDoctorReport({ projectRoot: root, nodeVersion: "26.4.0" }, async () => true);
  assert.equal(doctor.healthy, false);
  assert.equal(capabilityCheck(doctor).status, "fail");
  assert.deepEqual(await snapshot(root), before);
});

test("binary content is hashed as bytes, including invalid UTF-8 and NUL", async t => {
  const { root } = await fixture(t);
  const first = Buffer.from([0xff, 0x00, 0xc0, 0x80]);
  const second = Buffer.from([0xfe, 0x00, 0xc0, 0x80]);
  assert.equal(first.toString("utf8"), second.toString("utf8"));
  const record = await state(root);
  record.capabilities[0].files[0].sha256 = digest(first);
  await saveState(root, record);
  await writeFile(join(root, routePath), first);
  let report = inspectCapabilities(root);
  assert.equal(onlyFile(report).status, "unchanged");
  assert.equal(onlyFile(report).actualSha256, digest(first));
  await writeFile(join(root, routePath), second);
  report = inspectCapabilities(root);
  assert.equal(onlyFile(report).status, "modified");
  assert.equal(onlyFile(report).actualSha256, digest(second));
  assert.deepEqual(await readFile(join(root, routePath)), second);
});

test("recorded versions remain tracking identities rather than a bundled support or trust claim", async t => {
  const { root } = await fixture(t);
  const record = await state(root);
  record.solution.version = "9.0.0";
  record.template.version = "8.0.0";
  record.capabilities[0].version = "7.0.0";
  await saveState(root, record);
  const before = await snapshot(root);
  const report = inspectCapabilities(root);
  assert.deepEqual(report.solution, { id: "web-app", version: "9.0.0" });
  assert.equal(report.capabilities[0].version, "7.0.0");
  assert.equal(report.healthy, true);
  assert.equal(report.clean, true);
  assert.deepEqual(await snapshot(root), before);
});

test("hard-linked registered files are unsafe and are not read through or changed", async t => {
  const { parent, root } = await fixture(t);
  const outside = join(parent, "outside-linked.txt");
  await link(join(root, routePath), outside);
  const original = await readFile(outside);
  const report = inspectCapabilities(root);
  assert.equal(report.healthy, false);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.deepEqual(await readFile(outside), original);
  assert.deepEqual(await readFile(join(root, routePath)), original);
});

test("directory targets fail safely without recursive inspection", async t => {
  const { root } = await fixture(t);
  await unlink(join(root, routePath));
  await mkdir(join(root, routePath));
  await writeFile(join(root, routePath, "private.txt"), "PRIVATE_DIRECTORY_CONTENT");
  const before = await snapshot(root);
  const report = inspectCapabilities(root);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DIRECTORY_CONTENT|private.txt/);
  assert.deepEqual(await snapshot(root), before);
});

test("the exact 1 MiB source-file boundary is checked but oversized files are unsafe", async t => {
  const { root } = await fixture(t);
  const bytes = Buffer.alloc(1024 * 1024, 0x5a);
  const record = await state(root);
  record.capabilities[0].files[0].sha256 = digest(bytes);
  await saveState(root, record);
  await writeFile(join(root, routePath), bytes);
  assert.equal(onlyFile(inspectCapabilities(root)).status, "unchanged");
  const oversized = Buffer.concat([bytes, Buffer.from([0x5a])]);
  await writeFile(join(root, routePath), oversized);
  const report = inspectCapabilities(root);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.deepEqual(await readFile(join(root, routePath)), oversized);
});

test("symlink or junction ancestors cannot read outside the selected project", async t => {
  const { parent, root } = await fixture(t);
  const outside = join(parent, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "route.ts"), "PRIVATE_OUTSIDE_TRIPWIRE");
  await rm(join(root, "app/api/health"), { recursive: true });
  await symlink(outside, join(root, "app/api/health"), process.platform === "win32" ? "junction" : "dir");
  const before = await snapshot(root);
  const report = inspectCapabilities(root);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_OUTSIDE_TRIPWIRE/);
  assert.equal(await readFile(join(outside, "route.ts"), "utf8"), "PRIVATE_OUTSIDE_TRIPWIRE");
  assert.deepEqual(await snapshot(root), before);
});

test("a registered file symlink is unsafe without following its target", async t => {
  const { parent, root } = await fixture(t);
  const outside = join(parent, "outside.txt");
  await writeFile(outside, "PRIVATE_SYMLINK_TRIPWIRE");
  await unlink(join(root, routePath));
  try { await symlink(outside, join(root, routePath), "file"); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows host does not permit file symlink creation.");
      return;
    }
    throw error;
  }
  const report = inspectCapabilities(root);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SYMLINK_TRIPWIRE/);
  assert.equal(await readFile(outside, "utf8"), "PRIVATE_SYMLINK_TRIPWIRE");
});

test("changing a tracked source during its read is unsafe, not a digest comparison result", async t => {
  const { root } = await fixture(t);
  const target = join(root, routePath);
  const identity = fsSync.statSync(target, { bigint: true });
  const originalRead = fsSync.readSync;
  let changed = false;
  fsSync.readSync = (...args) => {
    const current = fsSync.fstatSync(args[0], { bigint: true });
    if (!changed && current.dev === identity.dev && current.ino === identity.ino) {
      changed = true;
      fsSync.writeFileSync(target, "changed during inspection\n");
    }
    return originalRead(...args);
  };
  let report;
  try { report = inspectCapabilities(root); }
  finally { fsSync.readSync = originalRead; }
  assert.equal(changed, true);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.equal(await readFile(target, "utf8"), "changed during inspection\n"); // codeql[js/file-system-race] -- Intentional mutation of an owned fixture; product inspection must reject it above.
});

test("large file identifiers that round to the same Number still reject a replacement descriptor", async t => {
  const { root } = await fixture(t);
  const target = join(root, routePath);
  const beforeIno = 9007199254740992n;
  const replacementIno = 9007199254740993n;
  assert.equal(Number(beforeIno), Number(replacementIno));
  const original = { open: fsSync.openSync, lstat: fsSync.lstatSync,
    fstat: fsSync.fstatSync, read: fsSync.readSync };
  let descriptor;
  let managedReads = 0;
  fsSync.openSync = (...args) => {
    const fd = original.open(...args);
    if (String(args[0]) === target) descriptor = fd;
    return fd;
  };
  fsSync.lstatSync = (...args) => {
    const information = original.lstat(...args);
    if (String(args[0]) === target) information.ino = typeof information.ino === "bigint"
      ? beforeIno : Number(beforeIno);
    return information;
  };
  fsSync.fstatSync = (...args) => {
    const information = original.fstat(...args);
    if (args[0] === descriptor) information.ino = typeof information.ino === "bigint"
      ? replacementIno : Number(replacementIno);
    return information;
  };
  fsSync.readSync = (...args) => {
    if (args[0] === descriptor) managedReads++;
    return original.read(...args);
  };
  let report;
  try { report = inspectCapabilities(root); }
  finally {
    fsSync.openSync = original.open; fsSync.lstatSync = original.lstat;
    fsSync.fstatSync = original.fstat; fsSync.readSync = original.read;
  }
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
  assert.equal(managedReads, 0);
});

for (const [name, content] of [
  ["missing", null],
  ["malformed", '{"secret":"PRIVATE_METADATA_TRIPWIRE",'],
  ["duplicate keys", '{"schemaVersion":1,"schemaVersion":1}'],
  ["unknown fields", '{"schemaVersion":1,"secret":"PRIVATE_METADATA_TRIPWIRE"}'],
]) {
  test(`${name} solution metadata produces a failure report without echoing or repairing it`, async t => {
    const { root } = await fixture(t, false);
    if (content === null) await unlink(join(root, statePath));
    else await writeFile(join(root, statePath), content);
    const before = await snapshot(root);
    const report = inspectCapabilities(root);
    assert.equal(report.healthy, false);
    assert.equal(report.clean, false);
    assert.equal(report.solution, null);
    assert.deepEqual(report.capabilities, []);
    assert.equal(report.diagnostics[0].status, "fail");
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_METADATA_TRIPWIRE/);
    assert.deepEqual(await snapshot(root), before);
  });
}

test("the aggregate read budget admits no over-budget file, including partial budgets and unsafe snapshots", async t => {
  const { root } = await fixture(t, false);
  const bytes = Buffer.alloc(1024 * 1024, 0x5a);
  const sha256 = digest(bytes);
  await mkdir(join(root, "assets"));
  const files = [];
  for (let index = 0; index < 66; index++) {
    const path = `assets/payload-${String(index).padStart(3, "0")}.bin`;
    await writeFile(join(root, path), bytes);
    files.push({ path, sha256 });
  }
  const record = await state(root);
  record.capabilities = [{ id: "health", version: "1.0.0", files }];
  await saveState(root, record);
  const metadataBefore = await readFile(join(root, statePath));
  const relativePaths = files.map(file => file.path);
  const maximum = 64 * 1024 * 1024;
  const full = auditedInspection(root, relativePaths);
  const report = full.report;
  const unexpected = report.capabilities[0].files.filter((file, index) =>
    file.status !== (index < 64 ? "unchanged" : "not-checked"));
  const failureDetails = JSON.stringify({ managedBytesRead: full.managedBytesRead,
    unexpected: unexpected.map(file => ({ ...file, stats: full.statTraces.get(join(root, file.path)) })) }, null, 2);
  assert.equal(report.healthy, false);
  assert.equal(report.clean, false);
  assert.equal(report.capabilities[0].files.filter(file => file.status === "unchanged").length, 64, failureDetails);
  assert.equal(report.capabilities[0].files.filter(file => file.status === "not-checked").length, 2);
  for (const file of report.capabilities[0].files.slice(64)) assert.equal(file.actualSha256, undefined);
  assert.equal(full.managedBytesRead, maximum);
  assert.equal(full.openedPaths.size, 64);
  assert.equal(full.readPaths.size, 64, JSON.stringify({
    missingReads: [...full.openedPaths].filter(path => !full.readPaths.has(path)) }, null, 2));
  for (const path of relativePaths.slice(64)) {
    assert.equal(full.openedPaths.has(join(root, path)), false);
    assert.equal(full.readPaths.has(join(root, path)), false);
  }
  assert.deepEqual(await readFile(join(root, statePath)), metadataBefore);
  assert.equal((await readdir(join(root, "assets"))).length, 66);

  // Leave 16 bytes in the budget: a 17-byte file must fail before open, rather
  // than reading the whole file and only discovering the excess afterwards.
  const partialLast = bytes.subarray(0, bytes.length - 16);
  const overRemainder = Buffer.alloc(17, 0x5a);
  await writeFile(join(root, files[63].path), partialLast);
  await writeFile(join(root, files[64].path), overRemainder);
  files[63].sha256 = digest(partialLast);
  files[64].sha256 = digest(overRemainder);
  await saveState(root, record);
  const partial = auditedInspection(root, relativePaths);
  assert.equal(partial.managedBytesRead, maximum - 16);
  assert.equal(partial.report.capabilities[0].files[63].status, "unchanged");
  assert.equal(partial.report.capabilities[0].files[64].status, "not-checked");
  assert.equal(partial.report.capabilities[0].files[65].status, "not-checked");
  assert.equal(partial.openedPaths.has(join(root, files[64].path)), false);
  assert.equal(partial.readPaths.has(join(root, files[64].path)), false);

  // Failed snapshots also consume their actual read bytes. Otherwise many
  // changing sources could evade the budget by never producing a valid hash.
  for (const index of [63, 64]) {
    await writeFile(join(root, files[index].path), bytes);
    files[index].sha256 = sha256;
  }
  await saveState(root, record);
  const changing = auditedInspection(root, relativePaths, true);
  assert.equal(changing.managedBytesRead, maximum);
  assert.equal(changing.mutatedPaths.size, 64);
  assert.equal(changing.report.healthy, false);
  assert.equal(changing.report.capabilities[0].files.filter(file => file.status === "unsafe").length, 64);
  assert.equal(changing.report.capabilities[0].files.filter(file => file.status === "not-checked").length, 2);
  for (const path of relativePaths.slice(64)) {
    assert.equal(changing.openedPaths.has(join(root, path)), false);
    assert.equal(changing.readPaths.has(join(root, path)), false);
  }
});

test("FIFO sources fail before opening, within a bounded subprocess", { skip: process.platform === "win32" }, async t => {
  const { root } = await fixture(t);
  await unlink(join(root, routePath));
  execFileSync("mkfifo", [join(root, routePath)]);
  const api = new URL("../../dist/solutions/index.js", import.meta.url).href;
  const script = `const { inspectCapabilities } = await import(${JSON.stringify(api)}); console.log(JSON.stringify(inspectCapabilities(${JSON.stringify(root)})));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024,
  });
  const report = JSON.parse(output);
  assert.equal(onlyFile(report).status, "unsafe");
  assert.equal(onlyFile(report).actualSha256, undefined);
});

test("CLI verification has clean JSON, no project activation, and stable failure/quiet behavior", async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, "plugins"));
  await writeFile(join(root, "plugins", "tripwire.js"), "throw new Error('PROJECT_EXECUTED_TRIPWIRE');");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  packageJson.scripts.preinstall = "node -e \"require('fs').writeFileSync('unexpected-execution.txt','ran')\"";
  await writeFile(join(root, "package.json"), JSON.stringify(packageJson));
  const before = await snapshot(root);
  const clean = cliRun(root, ["--json"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout).clean, true);
  assert.doesNotMatch(clean.stdout + clean.stderr, /PROJECT_EXECUTED_TRIPWIRE|Aurora Runtime/);
  assert.deepEqual(await snapshot(root), before);

  await writeFile(join(root, routePath), "// PRIVATE_CLI_TRIPWIRE\n");
  const edited = await snapshot(root);
  const modified = cliRun(root, ["--json"]);
  assert.equal(modified.status, 1);
  assert.equal(JSON.parse(modified.stdout).healthy, true);
  assert.equal(JSON.parse(modified.stdout).clean, false);
  assert.match(modified.stderr, /CAPABILITY_INSPECTION_FAILED/);
  assert.doesNotMatch(modified.stdout + modified.stderr, /PRIVATE_CLI_TRIPWIRE|PROJECT_EXECUTED_TRIPWIRE/);
  const quiet = cliRun(root, ["--json", "--quiet"]);
  assert.equal(quiet.status, 1);
  assert.equal(quiet.stdout, "");
  assert.match(quiet.stderr, /CAPABILITY_INSPECTION_FAILED/);
  assert.deepEqual(await snapshot(root), edited);
});
