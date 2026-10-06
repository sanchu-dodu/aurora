import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ErrorCodes } from "../../dist/errors/errorCodes.js";
import { OperationPlanService } from "../../dist/operations/operationPlanService.js";
import {
  DurableOperationTransaction,
  recoverOperationTransaction,
} from "../../dist/operations/durableOperationTransaction.js";
import {
  listOperationJournals,
  readOperationJournal,
  serializeOperationJournalEnvelope,
} from "../../dist/operations/operationJournal.js";
import { ProjectLifecycleLock } from "../../dist/packages/lifecycle/projectLifecycleLock.js";
import { LifecycleJournalStore } from "../../dist/packages/lifecycle/lifecycleJournalStore.js";
import { LifecycleRecoveryManager } from "../../dist/packages/lifecycle/lifecycleRecoveryManager.js";
import { inspectProject } from "../../dist/projects/projectInspection.js";

const NOW = Date.parse("2026-10-05T08:00:00.000Z");
const TIMESTAMP = new Date(NOW).toISOString();
const transactionModule = new URL("../../dist/operations/durableOperationTransaction.js", import.meta.url).href;
const lockModule = new URL("../../dist/packages/lifecycle/projectLifecycleLock.js", import.meta.url).href;
const serviceModule = new URL("../../dist/operations/operationPlanService.js", import.meta.url).href;
const cliEntry = new URL("../../dist/index.js", import.meta.url);
const guardError = /blocked by pending or unsafe operation-plan recovery metadata/u;

const workerSource = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import { DurableOperationTransaction, recoverOperationTransaction } from ${JSON.stringify(transactionModule)};
  import { ProjectLifecycleLock } from ${JSON.stringify(lockModule)};
  import { OperationPlanService } from ${JSON.stringify(serviceModule)};
  let transaction;
  let observedTransactionId;
  let openBarrier;
  const barrier = new Promise(resolve => { openBarrier = resolve; });
  const send = message => process.send(message);
  const acquire = ProjectLifecycleLock.acquire;
  ProjectLifecycleLock.acquire = async function (...args) {
    send({ event: "acquiring" });
    const result = await acquire.apply(this, args);
    send({ event: "acquired", token: result.ownerToken });
    return result;
  };
  process.on("message", async message => {
    if (message.event === "release") { openBarrier(); return; }
    if (message.event !== "start") return;
    const pause = async point => {
      if (message.point !== point) return;
      send({ event: "barrier", point, transactionId: transaction?.transactionId ?? message.transactionId ?? observedTransactionId });
      await barrier;
    };
    let lock;
    try {
      const rename = fs.rename;
      fs.rename = async function (source, destination) {
        await rename.call(this, source, destination);
        if (path.dirname(path.resolve(destination)) === path.join(message.root, ".aurora", "operation-journal") &&
            path.basename(source).startsWith(".operation-journal-candidate-")) {
          observedTransactionId = path.basename(destination);
          await pause("preparing");
        }
        if (path.resolve(destination) === path.join(message.root, "first.txt")) {
          await pause(message.action === "recover" ? "first-restored" : "first-renamed");
        }
      };
      if (message.action === "apply") {
        const prepare = DurableOperationTransaction.prepare;
        DurableOperationTransaction.prepare = async function (...args) {
          transaction = await prepare.apply(this, args);
          await pause("prepared");
          return transaction;
        };
        const result = await new OperationPlanService({ now: () => message.now }).apply(message.plan, message.root, { approved: true });
        send({ event: "result", status: result.status });
      } else {
        lock = await ProjectLifecycleLock.acquire(message.root, {
          ...(message.action === "recover" ? { allowOperationRecovery: true } : {}),
        });
        if (message.action === "recover") {
          await recoverOperationTransaction(message.root, message.transactionId, lock);
          send({ event: "result", status: "recovered" });
        } else {
          transaction = await DurableOperationTransaction.prepare(message.plan, message.root, lock, message.timestamp);
          await pause("prepared");
          await transaction.beginMutation();
          await pause("mutating");
          for (const operation of message.plan.operations) {
            await transaction.writeOperation(operation.id);
            if (operation.id === "op-001") await pause("first-written");
          }
          await transaction.beginVerification();
          await pause("verifying");
          await transaction.commitDurably();
          await pause("committed");
          send({ event: "result", status: "committed" });
        }
      }
    } catch (error) {
      send({ event: "result", code: error.code, message: error.message });
    } finally {
      if (lock?.isHeld) await lock.release();
      process.disconnect();
    }
  });
  send({ event: "ready" });
`;

function worker() {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", workerSource], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const messages = [];
  const waiters = [];
  let output = "";
  let finished = false;
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.on("message", message => {
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (message.event === waiter.event || (message.event === "result" && waiter.event !== "result")) {
        waiters.splice(waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timeout);
        if (message.event === waiter.event) waiter.resolve(message);
        else waiter.reject(new Error(`Worker failed before ${waiter.event}: ${JSON.stringify(message)} ${output}`));
      }
    }
  });
  const closed = new Promise(resolve => child.once("close", () => {
    finished = true;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`Worker closed before ${waiter.event}: ${output}`));
    }
    resolve();
  }));
  child.on("error", error => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  });
  return {
    messages,
    waitFor(event) {
      const delivered = messages.find(message => message.event === event);
      if (delivered) return Promise.resolve(delivered);
      if (finished) return Promise.reject(new Error(`Worker already closed: ${output}`));
      return new Promise((resolve, reject) => {
        const waiter = { event, resolve, reject };
        waiter.timeout = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${event}: ${output}`));
        }, 10000);
        waiters.push(waiter);
      });
    },
    start(input) { child.send({ event: "start", now: NOW, timestamp: TIMESTAMP, ...input }); },
    release() { child.send({ event: "release" }); },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    },
  };
}

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "aurora-operation-recovery-"));
  await fs.writeFile(join(root, "first.txt"), "before-first\n", { mode: 0o640 });
  await fs.writeFile(join(root, "last.txt"), "before-last\n");
  const beforeMode = (await fs.stat(join(root, "first.txt"))).mode & 0o777;
  const rootMode = (await fs.stat(root)).mode & 0o777;
  const plan = await new OperationPlanService({ now: () => NOW }).createFileWriteBatchPlan({
    projectRoot: root, intent: "test.durable-recovery", summary: "Recover an interrupted batch",
    files: [
      { relativePath: "first.txt", content: "after-first\n", mode: 0o600, directoryMode: 0o700 },
      { relativePath: "nested/second.txt", content: "after-second\n" },
      { relativePath: "last.txt", content: "after-last\n" },
    ],
  });
  return { root, plan, beforeMode, rootMode };
}

async function interrupted(point = "first-written") {
  const value = await fixture();
  const child = worker();
  try {
    await child.waitFor("ready");
    child.start({ ...value, point, action: "transaction" });
    const barrier = await child.waitFor("barrier");
    assert.equal(barrier.point, point);
    assert.match(barrier.transactionId, /^[a-f0-9-]{36}$/u);
    await child.stop();
    return { ...value, transactionId: barrier.transactionId };
  } catch (error) {
    await child.stop();
    await fs.rm(value.root, { recursive: true, force: true });
    throw error;
  }
}

function journalDirectory(value, recovered = false) {
  return join(value.root, ".aurora", "operation-journal", ...(recovered ? ["recovered"] : []), value.transactionId);
}

async function missing(target) {
  await assert.rejects(fs.lstat(target), { code: "ENOENT" });
}

async function withRecoveryLock(root, action) {
  const lock = await ProjectLifecycleLock.acquire(root, { allowOperationRecovery: true });
  try { return await action(lock); }
  finally { if (lock.isHeld) await lock.release(); }
}

async function recover(value) {
  return withRecoveryLock(value.root, lock => recoverOperationTransaction(value.root, value.transactionId, lock));
}

async function snapshot(root) {
  const result = {};
  async function visit(directory, prefix = "") {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === ".aurora/lifecycle-lock" || relative.startsWith(".aurora/.lifecycle-lock-")) continue;
      const target = join(directory, entry.name);
      const info = await fs.lstat(target);
      if (entry.isDirectory()) {
        result[relative] = { kind: "directory", mode: info.mode & 0o777 };
        await visit(target, relative);
      } else {
        result[relative] = { kind: "file", mode: info.mode & 0o777, bytes: (await fs.readFile(target)).toString("hex") };
      }
    }
  }
  await visit(root);
  return result;
}

async function assertOriginal(value) {
  assert.equal(await fs.readFile(join(value.root, "first.txt"), "utf8"), "before-first\n");
  assert.equal(await fs.readFile(join(value.root, "last.txt"), "utf8"), "before-last\n");
  assert.equal((await fs.stat(join(value.root, "first.txt"))).mode & 0o777, value.beforeMode);
  assert.equal((await fs.stat(value.root)).mode & 0o777, value.rootMode);
  await missing(join(value.root, "nested"));
}

for (const point of ["preparing", "prepared", "mutating", "first-renamed", "first-written", "verifying"]) {
  test(`killed process at ${point} retains evidence and recovers original files exactly once`, async () => {
    const value = await interrupted(point);
    try {
      const owner = JSON.parse(await fs.readFile(join(value.root, ".aurora/lifecycle-lock"), "utf8"));
      assert.notEqual(owner.pid, process.pid);
      await recover(value);
      await assertOriginal(value);
      await missing(journalDirectory(value));
      await fs.access(join(journalDirectory(value, true), "journal.json"));
      await missing(join(value.root, ".aurora/lifecycle-lock"));
      await fs.writeFile(join(value.root, "first.txt"), "edit-after-recovery\n");
      const before = await snapshot(value.root);
      await recover(value);
      assert.deepEqual(await snapshot(value.root), before);
    } finally { await fs.rm(value.root, { recursive: true, force: true }); }
  });
}

test("durable commit survives a killed process and cannot be rolled back", async () => {
  const value = await interrupted("committed");
  try {
    await fs.writeFile(join(value.root, "first.txt"), "user-edit-after-commit\n");
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
    assert.equal(await fs.readFile(join(value.root, "nested/second.txt"), "utf8"), "after-second\n");
    assert.equal((await readOperationJournal(value.root, value.transactionId)).phase, "committed");
    const lock = await ProjectLifecycleLock.acquire(value.root);
    await lock.release();
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("late recovery conflict preflight preserves every earlier target and all journal evidence", async () => {
  const value = await interrupted("verifying");
  try {
    await fs.writeFile(join(value.root, "last.txt"), "user-edit-late-target\n");
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.OPERATION_RECOVERY_CONFLICT });
    assert.deepEqual(await snapshot(value.root), before);
    assert.equal(await fs.readFile(join(value.root, "first.txt"), "utf8"), "after-first\n");
    await missing(journalDirectory(value, true));
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("a distinct Linux case-alias child stops recovery before any target changes", { skip: process.platform !== "linux" }, async () => {
  const value = await interrupted("verifying");
  try {
    await fs.writeFile(join(value.root, "nested/SECOND.TXT"), "unrelated-user-file\n");
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.OPERATION_RECOVERY_CONFLICT });
    assert.deepEqual(await snapshot(value.root), before);
    assert.equal(await fs.readFile(join(value.root, "nested/second.txt"), "utf8"), "after-second\n");
    await missing(journalDirectory(value, true));
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

for (const mutation of ["existing-edit", "created-edit", "existing-delete", "extra-child", "untouched-created"]) {
  test(`recovery preserves ${mutation} and refuses to claim user changes`, async () => {
    const value = await interrupted(mutation === "untouched-created" ? "first-written" : "verifying");
    try {
      if (mutation === "existing-edit") await fs.writeFile(join(value.root, "first.txt"), "editor-owned\n");
      if (mutation === "created-edit") await fs.writeFile(join(value.root, "nested/second.txt"), "editor-owned\n");
      if (mutation === "existing-delete") await fs.unlink(join(value.root, "first.txt"));
      if (mutation === "extra-child") await fs.writeFile(join(value.root, "nested/external.txt"), "editor-owned\n");
      if (mutation === "untouched-created") {
        await fs.mkdir(join(value.root, "nested"));
        await fs.writeFile(join(value.root, "nested/second.txt"), "editor-owned\n");
      }
      const before = await snapshot(value.root);
      await assert.rejects(recover(value), { code: ErrorCodes.OPERATION_RECOVERY_CONFLICT });
      assert.deepEqual(await snapshot(value.root), before);
    } finally { await fs.rm(value.root, { recursive: true, force: true }); }
  });
}

test("recovery preserves a user's deletion of a created target and never recreates it", async () => {
  const value = await interrupted("verifying");
  try {
    await fs.unlink(join(value.root, "nested/second.txt"));
    await recover(value);
    await assertOriginal(value);
    await missing(join(value.root, "nested/second.txt"));
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("recovery preserves externally changed permissions before altering any target", { skip: process.platform === "win32" }, async () => {
  const value = await interrupted("verifying");
  try {
    await fs.chmod(join(value.root, "last.txt"), 0o400);
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.OPERATION_RECOVERY_CONFLICT });
    assert.deepEqual(await snapshot(value.root), before);
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

for (const target of ["first.txt", "nested/second.txt"]) {
  test(`drift after durable capture preserves editor-owned ${target} without rollback overwrite`, async () => {
    const value = await fixture();
    const child = worker();
    try {
      await child.waitFor("ready");
      child.start({ ...value, action: "apply", point: "prepared" });
      await child.waitFor("barrier");
      if (target.startsWith("nested/")) await fs.mkdir(join(value.root, "nested"));
      await fs.writeFile(join(value.root, target), "editor-after-capture\n");
      child.release();
      assert.equal((await child.waitFor("result")).code, ErrorCodes.OPERATION_PLAN_DRIFT);
      assert.equal(await fs.readFile(join(value.root, target), "utf8"), "editor-after-capture\n");
      assert.equal(await fs.readFile(join(value.root, "last.txt"), "utf8"), "before-last\n");
      if (target === "first.txt") await missing(join(value.root, "nested"));
      else assert.equal(await fs.readFile(join(value.root, "first.txt"), "utf8"), "before-first\n");
    } finally {
      await child.stop();
      await fs.rm(value.root, { recursive: true, force: true });
    }
  });
}

test("killed recovery replays safely without undoing edits after the terminal archive", async () => {
  const value = await interrupted("verifying");
  const child = worker();
  try {
    await child.waitFor("ready");
    child.start({ ...value, action: "recover", point: "first-restored" });
    await child.waitFor("barrier");
    await child.stop();
    await recover(value);
    await assertOriginal(value);
    await fs.writeFile(join(value.root, "last.txt"), "legitimate-after-recovery\n");
    const before = await snapshot(value.root);
    await recover(value);
    assert.deepEqual(await snapshot(value.root), before);
  } finally {
    await child.stop();
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("pending plan evidence blocks default package authority and remains outside package recovery", async () => {
  const value = await interrupted();
  try {
    const before = await snapshot(value.root);
    await assert.rejects(ProjectLifecycleLock.acquire(value.root), guardError);
    assert.deepEqual(await snapshot(value.root), before);
    await withRecoveryLock(value.root, async lock => {
      assert.deepEqual(await new LifecycleRecoveryManager(value.root).recoverIncomplete(lock), []);
    });
    assert.deepEqual(await snapshot(value.root), before);
    await missing(join(value.root, ".aurora/lifecycle-journal"));
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("recovery holds shared lifecycle authority through restoration and terminal archive", async () => {
  const value = await interrupted("verifying");
  const recovery = worker();
  const contender = worker();
  try {
    const freshPlan = await new OperationPlanService({ now: () => NOW }).createFileWritePlan({
      projectRoot: value.root, relativePath: "winner.txt", content: "winner\n",
      summary: "Wait for operation recovery", intent: "test.recovery-concurrency",
    });
    await Promise.all([recovery.waitFor("ready"), contender.waitFor("ready")]);
    recovery.start({ ...value, action: "recover", point: "first-restored" });
    const owner = await recovery.waitFor("acquired");
    await recovery.waitFor("barrier");
    contender.start({ root: value.root, plan: freshPlan, action: "transaction" });
    await contender.waitFor("acquiring");
    assert.equal(contender.messages.some(message => message.event === "acquired"), false);
    assert.equal(JSON.parse(await fs.readFile(join(value.root, ".aurora/lifecycle-lock"), "utf8")).token, owner.token);
    await missing(join(value.root, "winner.txt"));
    recovery.release();
    assert.equal((await recovery.waitFor("result")).status, "recovered");
    assert.equal((await contender.waitFor("result")).status, "committed");
    assert.equal(await fs.readFile(join(value.root, "winner.txt"), "utf8"), "winner\n");
    await assertOriginal(value);
  } finally {
    await Promise.all([recovery.stop(), contender.stop()]);
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("explicit plan recovery requires verified authority for the exact project and transaction", async () => {
  const value = await interrupted();
  const other = await fs.mkdtemp(join(tmpdir(), "aurora-operation-recovery-other-"));
  let foreign;
  try {
    const before = await snapshot(value.root);
    await assert.rejects(recoverOperationTransaction(value.root, value.transactionId, undefined));
    foreign = await ProjectLifecycleLock.acquire(other);
    await assert.rejects(recoverOperationTransaction(value.root, value.transactionId, foreign));
    await withRecoveryLock(value.root, lock => assert.rejects(
      recoverOperationTransaction(value.root, "../outside", lock), { code: ErrorCodes.INVALID_OPERATION_PLAN },
    ));
    await withRecoveryLock(value.root, lock => assert.rejects(
      recoverOperationTransaction(value.root, randomUUID(), lock), { code: ErrorCodes.INVALID_OPERATION_PLAN },
    ));
    assert.deepEqual(await snapshot(value.root), before);
  } finally {
    if (foreign?.isHeld) await foreign.release();
    await fs.rm(value.root, { recursive: true, force: true });
    await fs.rm(other, { recursive: true, force: true });
  }
});

for (const mutation of ["malformed", "duplicate-key", "invalid-utf8", "schema", "wrong-id", "wrong-root", "missing-blob", "corrupt-blob", "missing-plan", "tampered-plan"]) {
  test(`invalid ${mutation} recovery metadata fails closed before changing any target`, async () => {
    const value = await interrupted("verifying");
    try {
      const file = join(journalDirectory(value), "journal.json");
      const original = await fs.readFile(file, "utf8");
      const journal = await readOperationJournal(value.root, value.transactionId);
      if (mutation === "malformed") await fs.writeFile(file, "{invalid");
      if (mutation === "duplicate-key") {
        const duplicate = original.replace('"schemaVersion": 1', '"schemaVersion": 99, "schemaVersion": 1');
        assert.notEqual(duplicate, original);
        await fs.writeFile(file, duplicate);
      }
      if (mutation === "invalid-utf8") {
        const bytes = Buffer.from(original);
        const index = bytes.indexOf(Buffer.from("operation-plan"));
        assert.notEqual(index, -1);
        bytes[index] = 0xff;
        await fs.writeFile(file, bytes);
      }
      if (mutation === "schema") await fs.writeFile(file, JSON.stringify({ ...JSON.parse(original), journal: { ...journal, schemaVersion: 99 } }));
      if (mutation === "wrong-id") await fs.writeFile(file, serializeOperationJournalEnvelope({ ...journal, transactionId: randomUUID() }));
      if (mutation === "wrong-root") await fs.writeFile(file, serializeOperationJournalEnvelope({ ...journal, projectFingerprint: "0".repeat(64) }));
      if (mutation === "missing-blob" || mutation === "corrupt-blob") {
        const entry = journal.files.find(entry => entry.path === "last.txt");
        assert.equal(entry.before.kind, "file");
        const blob = join(journalDirectory(value), "blobs", `${entry.before.sha256}.bin`);
        if (mutation === "missing-blob") await fs.unlink(blob);
        else await fs.writeFile(blob, Buffer.alloc(entry.before.size, 0x78));
      }
      const planFile = join(journalDirectory(value), "plan.json");
      if (mutation === "missing-plan") await fs.unlink(planFile);
      if (mutation === "tampered-plan") {
        const storedPlan = JSON.parse(await fs.readFile(planFile, "utf8"));
        await fs.writeFile(planFile, JSON.stringify({ ...storedPlan, summary: "Tampered canonical plan" }));
      }
      const before = await snapshot(value.root);
      await assert.rejects(recover(value), { code: ErrorCodes.INVALID_OPERATION_PLAN });
      assert.deepEqual(await snapshot(value.root), before);
      await assert.rejects(ProjectLifecycleLock.acquire(value.root), guardError);
      assert.deepEqual(await snapshot(value.root), before);
    } finally { await fs.rm(value.root, { recursive: true, force: true }); }
  });
}

test("list and CLI recovery dry-run remain read-only and do not activate the app runtime", async () => {
  const value = await interrupted("verifying");
  try {
    const before = await snapshot(value.root);
    const lockFile = join(value.root, ".aurora/lifecycle-lock");
    const authority = await fs.readFile(lockFile);
    const summaries = await listOperationJournals(value.root);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].transactionId, value.transactionId);
    for (const args of [
      ["recovery", "plans", "--project", value.root, "--json"],
      ["recovery", "plan", value.transactionId, "--project", value.root, "--dry-run", "--json"],
      ["recovery", "plan", value.transactionId, "--project", value.root, "--json"],
    ]) {
      const result = await runCli(args, value.root);
      if (!args.includes("--dry-run") && args[1] === "plan") {
        assert.equal(result.code, 1);
        assert.match(result.stderr, /OPERATION_APPROVAL_REQUIRED/u);
      } else {
        assert.equal(result.code, 0, result.stderr);
        JSON.parse(result.stdout);
      }
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Aurora Runtime|plugin activated|The command center for Aurora/iu);
      assert.deepEqual(await snapshot(value.root), before);
      assert.deepEqual(await fs.readFile(lockFile), authority);
    }
    const recovered = await runCli(["recovery", "plan", value.transactionId, "--project", value.root, "--yes", "--json"], value.root);
    assert.equal(recovered.code, 0, recovered.stderr);
    JSON.parse(recovered.stdout);
    assert.doesNotMatch(`${recovered.stdout}\n${recovered.stderr}`, /Aurora Runtime|plugin activated/iu);
    await assertOriginal(value);
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("recovery metadata may only reference the exact recorded plan targets", async () => {
  const value = await interrupted("verifying");
  try {
    await fs.writeFile(join(value.root, "unrelated.txt"), "unrelated-user-file\n");
    const journal = await readOperationJournal(value.root, value.transactionId);
    await fs.writeFile(join(journalDirectory(value), "journal.json"), serializeOperationJournalEnvelope({
      ...journal,
      files: journal.files.map(entry => entry.path === "last.txt" ? { ...entry, path: "unrelated.txt" } : entry),
    }));
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("authority protection allows exact sibling paths and ordinary Aurora configuration", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "aurora-operation-authority-sibling-"));
  try {
    const service = new OperationPlanService({ now: () => NOW });
    const plan = await service.createFileWriteBatchPlan({
      projectRoot: root, summary: "Write legitimate configuration siblings", intent: "test.authority-boundary",
      files: [
        { relativePath: ".aurora/config.json", content: "{}\n" },
        { relativePath: ".aurora/operation-journal-backup/readme.txt", content: "user-owned\n" },
        { relativePath: ".aurora/lifecycle-journal-notes.txt", content: "notes\n" },
      ],
    });
    assert.equal((await service.apply(plan, root, { approved: true })).status, "applied");
    assert.equal(await fs.readFile(join(root, ".aurora/config.json"), "utf8"), "{}\n");
    assert.equal(await fs.readFile(join(root, ".aurora/operation-journal-backup/readme.txt"), "utf8"), "user-owned\n");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("dry-run and journal list on a clean project create no lifecycle or journal metadata", async () => {
  const value = await fixture();
  const acquire = ProjectLifecycleLock.acquire;
  try {
    const before = await snapshot(value.root);
    ProjectLifecycleLock.acquire = async () => { throw new Error("Read-only calls must not acquire authority"); };
    assert.deepEqual(await listOperationJournals(value.root), []);
    const result = await new OperationPlanService({ now: () => NOW }).apply(value.plan, value.root, { dryRun: true, approved: false });
    assert.equal(result.status, "dry-run");
    assert.deepEqual(await snapshot(value.root), before);
    await missing(join(value.root, ".aurora"));
  } finally {
    ProjectLifecycleLock.acquire = acquire;
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("a package journal remains unchanged when the plan engine refuses application", async () => {
  const value = await fixture();
  let lock;
  try {
    lock = await ProjectLifecycleLock.acquire(value.root);
    await new LifecycleJournalStore(value.root).create({ operation: "install", packageIds: ["fixture-package"], timestamp: TIMESTAMP });
    await lock.release();
    const before = await snapshot(value.root);
    await assert.rejects(new OperationPlanService({ now: () => NOW }).apply(value.plan, value.root, { approved: true }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
    await missing(join(value.root, ".aurora/operation-journal"));
  } finally {
    if (lock?.isHeld) await lock.release();
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("unsupported and contradictory permission requests fail before lock creation, including dry-run", async () => {
  const value = await fixture();
  const service = new OperationPlanService({ now: () => NOW });
  try {
    const invalid = [
      { ...value.plan, operations: value.plan.operations.map((operation, index) => index === 0 ? { ...operation, mode: 0o200 } : operation) },
      { ...value.plan, operations: value.plan.operations.map((operation, index) => index === 0 ? { ...operation, directoryMode: 0o600 } : operation) },
      { ...value.plan, operations: value.plan.operations.map((operation, index) => index === 2 ? { ...operation, directoryMode: 0o755 } : operation) },
    ];
    const before = await snapshot(value.root);
    for (const plan of invalid) for (const dryRun of [false, true]) {
      await assert.rejects(service.apply(plan, value.root, { approved: true, dryRun }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
      assert.deepEqual(await snapshot(value.root), before);
      await missing(join(value.root, ".aurora"));
    }
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("mixed ancestor casing fails before lock creation in apply and dry-run", async () => {
  const value = await fixture();
  const service = new OperationPlanService({ now: () => NOW });
  const acquire = ProjectLifecycleLock.acquire;
  let acquisitions = 0;
  try {
    const before = await snapshot(value.root);
    ProjectLifecycleLock.acquire = async () => { acquisitions++; throw new Error("Invalid casing must not acquire authority"); };
    for (const paths of [
      ["mixed/first.txt", "Mixed/second.txt"],
      ["shared/mixed/first.txt", "shared/Mixed/second.txt"],
    ]) {
      const plan = { ...value.plan, operations: value.plan.operations.map((operation, index) => index < 2
        ? { ...operation, path: paths[index], expected: { exists: false } } : operation) };
      for (const dryRun of [false, true]) {
        await assert.rejects(service.apply(plan, value.root, { approved: true, dryRun }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
        assert.deepEqual(await snapshot(value.root), before);
        await missing(join(value.root, ".aurora"));
      }
    }
    assert.equal(acquisitions, 0);
  } finally {
    ProjectLifecycleLock.acquire = acquire;
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("direct preparation rejects mixed ancestor casing before publishing recovery metadata", async () => {
  const value = await fixture();
  let lock;
  try {
    lock = await ProjectLifecycleLock.acquire(value.root);
    const plan = { ...value.plan, operations: value.plan.operations.map((operation, index) => index < 2
      ? { ...operation, path: index === 0 ? "mixed/first.txt" : "Mixed/second.txt", expected: { exists: false } } : operation) };
    const before = await snapshot(value.root);
    await assert.rejects(DurableOperationTransaction.prepare(plan, value.root, lock, TIMESTAMP), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
    await missing(join(value.root, ".aurora/operation-journal"));
    await missing(join(value.root, "mixed"));
    await missing(join(value.root, "Mixed"));
  } finally {
    if (lock?.isHeld) await lock.release();
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("checksum-valid recovery metadata cannot change an ancestor's recorded casing", async () => {
  const value = await interrupted("verifying");
  try {
    const journal = await readOperationJournal(value.root, value.transactionId);
    await fs.writeFile(join(journalDirectory(value), "journal.json"), serializeOperationJournalEnvelope({
      ...journal,
      directories: journal.directories.map(directory => directory.path === "nested" ? { ...directory, path: "NESTED" } : directory),
    }));
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("a fault after terminal commit publication never rolls back committed output", async () => {
  const value = await fixture();
  const rename = fs.rename;
  let injected = false;
  try {
    fs.rename = async function (source, destination) {
      await rename.call(this, source, destination);
      if (destination.endsWith("journal.json") && JSON.parse(await fs.readFile(destination, "utf8")).journal.phase === "committed") {
        injected = true;
        throw new Error("Injected post-publication durability fault");
      }
    };
    await assert.rejects(new OperationPlanService({ now: () => NOW }).apply(value.plan, value.root, { approved: true }),
      { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.equal(injected, true);
    fs.rename = rename;
    const summaries = await listOperationJournals(value.root);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].phase, "committed");
    for (const operation of value.plan.operations) {
      assert.equal(await fs.readFile(join(value.root, operation.path), "utf8"), operation.content);
    }
    await missing(join(value.root, ".aurora/lifecycle-lock"));
  } finally {
    fs.rename = rename;
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("project inspection reports pending and invalid plan evidence without reading before-images", async () => {
  const value = await interrupted("first-written");
  try {
    const before = await snapshot(value.root);
    const pending = inspectProject(value.root);
    assert.equal(pending.pendingOperationPlans, 1);
    assert.equal(pending.healthy, false);
    assert.equal(pending.diagnostics.find(item => item.id === "project.operation-plans").status, "fail");
    assert.deepEqual(await snapshot(value.root), before);
    const journal = await readOperationJournal(value.root, value.transactionId);
    const blob = journal.files.find(file => file.before.kind === "file").before.sha256;
    await fs.unlink(join(journalDirectory(value), "blobs", `${blob}.bin`));
    assert.equal(inspectProject(value.root).pendingOperationPlans, 1);
    await fs.writeFile(join(journalDirectory(value), "journal.json"), "{invalid");
    const invalid = inspectProject(value.root);
    assert.equal(invalid.pendingOperationPlans, null);
    assert.equal(invalid.healthy, false);
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("a checksum-valid journal cannot invent directory-mode recovery authority", async () => {
  const value = await interrupted("verifying");
  try {
    const journal = await readOperationJournal(value.root, value.transactionId);
    const root = journal.directories.find(directory => directory.path === ".");
    await fs.writeFile(join(journalDirectory(value), "journal.json"), serializeOperationJournalEnvelope({
      ...journal,
      directories: journal.directories.map(directory => directory === root ? { ...directory, afterMode: root.afterMode === 0o700 ? 0o755 : 0o700 } : directory),
    }));
    const before = await snapshot(value.root);
    await assert.rejects(recover(value), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

test("full committed history rejects a new plan without overflowing the bounded inspector", async () => {
  const value = await fixture();
  const service = new OperationPlanService({ now: () => NOW });
  try {
    await service.apply(value.plan, value.root, { approved: true });
    const [summary] = await listOperationJournals(value.root);
    const journal = await readOperationJournal(value.root, summary.transactionId);
    const plan = await fs.readFile(join(value.root, ".aurora/operation-journal", summary.transactionId, "plan.json"));
    for (let index = 1; index < 128; index++) {
      const id = randomUUID();
      const directory = join(value.root, ".aurora/operation-journal", id);
      await fs.mkdir(directory);
      await fs.writeFile(join(directory, "plan.json"), plan);
      await fs.writeFile(join(directory, "journal.json"), serializeOperationJournalEnvelope({ ...journal, transactionId: id }));
    }
    const next = await service.createFileWritePlan({ projectRoot: value.root, relativePath: "capacity.txt", content: "new\n", summary: "Respect bounded history", intent: "test.capacity" });
    const before = await snapshot(value.root);
    await assert.rejects(service.apply(next, value.root, { approved: true }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.deepEqual(await snapshot(value.root), before);
    assert.equal((await listOperationJournals(value.root)).length, 128);
    assert.equal(inspectProject(value.root).pendingOperationPlans, 0);
    await missing(join(value.root, "capacity.txt"));
  } finally { await fs.rm(value.root, { recursive: true, force: true }); }
});

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(cliEntry), ...args], {
      cwd, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
}
