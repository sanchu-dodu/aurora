import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ErrorCodes } from "../../dist/errors/errorCodes.js";
import { OperationPlanService } from "../../dist/operations/operationPlanService.js";
import { LifecycleJournalStore } from "../../dist/packages/lifecycle/lifecycleJournalStore.js";
import { parseLifecycleJournalEnvelope, serializeLifecycleJournalEnvelope } from "../../dist/packages/lifecycle/lifecycleJournalSchema.js";
import { ProjectLifecycleLock } from "../../dist/packages/lifecycle/projectLifecycleLock.js";

const NOW = Date.parse("2026-10-05T08:00:00.000Z");
const operationModule = new URL("../../dist/operations/operationPlanService.js", import.meta.url).href;
const lockModule = new URL("../../dist/packages/lifecycle/projectLifecycleLock.js", import.meta.url).href;
const transactionModule = new URL("../../dist/operations/durableOperationTransaction.js", import.meta.url).href;

const workerSource = `
  import { OperationPlanService } from ${JSON.stringify(operationModule)};
  import { ProjectLifecycleLock } from ${JSON.stringify(lockModule)};
  import { DurableOperationTransaction } from ${JSON.stringify(transactionModule)};
  const send = value => process.send(value);
  let openBarrier;
  const barrier = new Promise(resolve => { openBarrier = resolve; });
  const acquire = ProjectLifecycleLock.acquire;
  ProjectLifecycleLock.acquire = async function (...args) {
    send({ event: "acquiring" });
    const lock = await acquire.apply(this, args);
    send({ event: "acquired", token: lock.ownerToken });
    return lock;
  };
  process.on("message", async message => {
    if (message.event === "release") { openBarrier(); return; }
    if (message.event !== "start") return;
    if (message.holdCapture) {
      const prepare = DurableOperationTransaction.prepare;
      DurableOperationTransaction.prepare = async function (...args) {
        const transaction = await prepare.apply(this, args);
        send({ event: "captured" });
        await barrier;
        return transaction;
      };
    }
    if (message.holdRollback) {
      const write = DurableOperationTransaction.prototype.writeOperation;
      DurableOperationTransaction.prototype.writeOperation = async function (operationId, ...args) {
        if (operationId === message.failOperationId) throw new Error("Injected write failure");
        return write.call(this, operationId, ...args);
      };
      const rollback = DurableOperationTransaction.prototype.rollback;
      DurableOperationTransaction.prototype.rollback = async function (...args) {
        send({ event: "rolling-back" });
        await barrier;
        await rollback.apply(this, args);
      };
    }
    try {
      const report = await new OperationPlanService({ now: () => message.now }).apply(
        message.plan, message.projectRoot, { approved: true }
      );
      send({ event: "result", status: report.status });
    } catch (error) {
      send({ event: "result", code: error.code, message: error.message, cause: error.cause?.message });
    } finally {
      process.disconnect();
    }
  });
  send({ event: "ready" });
`;

function worker() {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", workerSource], {
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  const messages = [];
  const waiters = [];
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.on("message", message => {
    messages.push(message);
    const index = waiters.findIndex(waiter => waiter.event === message.event);
    if (index !== -1) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    }
  });
  const closed = new Promise(resolve => child.once("close", resolve));
  child.on("error", error => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeout); waiter.reject(error);
    }
  });
  return {
    child,
    messages,
    async waitFor(event) {
      const delivered = messages.find(message => message.event === event);
      if (delivered) return delivered;
      return new Promise((resolve, reject) => {
        const waiter = { event, resolve, reject };
        waiter.timeout = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for worker ${event}: ${output}`));
        }, 10000);
        waiters.push(waiter);
      });
    },
    start(plan, projectRoot, extra = {}) {
      child.send({ event: "start", plan, projectRoot, now: NOW, ...extra });
    },
    release() { child.send({ event: "release" }); },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    },
  };
}

async function fixture() {
  return mkdtemp(join(tmpdir(), "aurora-plan-concurrency-"));
}

function service(clock = () => NOW) {
  return new OperationPlanService({ now: clock });
}

async function planFor(projectRoot, relativePath = "fresh.txt", content = "winner\n") {
  return service().createFileWritePlan({
    projectRoot, relativePath, content,
    summary: "Write a guarded file", intent: "concurrency-proof",
  });
}

async function absent(path) {
  await assert.rejects(readFile(path), { code: "ENOENT" });
}

test("competing processes serialize the same plan and preserve the winner's fresh file", async () => {
  const root = await fixture();
  const winner = worker();
  const contender = worker();
  try {
    const plan = await planFor(root);
    await Promise.all([winner.waitFor("ready"), contender.waitFor("ready")]);
    winner.start(plan, root, { holdCapture: true });
    const owner = await winner.waitFor("acquired");
    await winner.waitFor("captured");
    contender.start(plan, root);
    await contender.waitFor("acquiring");
    const authority = JSON.parse(await readFile(join(root, ".aurora/lifecycle-lock"), "utf8"));
    assert.equal(authority.token, owner.token);
    assert.equal(contender.messages.some(message => message.event === "acquired"), false);
    await absent(join(root, "fresh.txt"));
    winner.release();
    const [applied, blocked] = await Promise.all([winner.waitFor("result"), contender.waitFor("result")]);
    assert.equal(applied.status, "applied");
    assert.equal(blocked.code, ErrorCodes.OPERATION_PLAN_DRIFT);
    assert.equal(await readFile(join(root, "fresh.txt"), "utf8"), "winner\n");
    await absent(join(root, ".aurora/lifecycle-lock"));
  } finally {
    await Promise.all([winner.stop(), contender.stop()]);
    await rm(root, { recursive: true, force: true });
  }
});

test("the lifecycle lock remains held throughout rollback before a competing writer can apply", async () => {
  const root = await fixture();
  const failing = worker();
  const winner = worker();
  try {
    const failingPlan = await service().createFileWriteBatchPlan({
      projectRoot: root,
      files: [{ relativePath: "fresh.txt", content: "loser\n" }, { relativePath: "fail.txt", content: "fail\n" }],
      summary: "Exercise rollback", intent: "rollback-proof",
    });
    const winnerPlan = await planFor(root);
    await Promise.all([failing.waitFor("ready"), winner.waitFor("ready")]);
    failing.start(failingPlan, root, { holdRollback: true, failOperationId: "op-002" });
    const owner = await failing.waitFor("acquired");
    await failing.waitFor("rolling-back");
    assert.equal(await readFile(join(root, "fresh.txt"), "utf8"), "loser\n");
    winner.start(winnerPlan, root);
    await winner.waitFor("acquiring");
    const authority = JSON.parse(await readFile(join(root, ".aurora/lifecycle-lock"), "utf8"));
    assert.equal(authority.token, owner.token);
    assert.equal(winner.messages.some(message => message.event === "acquired"), false);
    failing.release();
    const [failure, applied] = await Promise.all([failing.waitFor("result"), winner.waitFor("result")]);
    assert.equal(failure.code, ErrorCodes.INVALID_OPERATION_PLAN);
    assert.equal(failure.cause, "Injected write failure");
    assert.equal(applied.status, "applied");
    assert.equal(await readFile(join(root, "fresh.txt"), "utf8"), "winner\n");
    await absent(join(root, "fail.txt"));
  } finally {
    await Promise.all([failing.stop(), winner.stop()]);
    await rm(root, { recursive: true, force: true });
  }
});

test("operation plans wait on the package lifecycle lock and recheck expiry after acquiring it", async () => {
  const root = await fixture();
  const contender = worker();
  let held;
  const acquire = ProjectLifecycleLock.acquire;
  try {
    const plan = await planFor(root);
    held = await acquire.call(ProjectLifecycleLock, root);
    await contender.waitFor("ready");
    contender.start(plan, root);
    await contender.waitFor("acquiring");
    assert.equal((await held.readOwner()).token, held.ownerToken);
    await absent(join(root, "fresh.txt"));
    await held.release();
    assert.equal((await contender.waitFor("result")).status, "applied");

    const expiringPlan = await planFor(root, "expired.txt");
    held = await acquire.call(ProjectLifecycleLock, root);
    let now = NOW;
    let attempted;
    const atAcquire = new Promise(resolve => { attempted = resolve; });
    ProjectLifecycleLock.acquire = async function (...args) {
      attempted();
      return acquire.apply(this, args);
    };
    const pending = service(() => now).apply(expiringPlan, root, { approved: true });
    const rejection = assert.rejects(pending, { code: ErrorCodes.OPERATION_PLAN_EXPIRED });
    await atAcquire;
    now = Date.parse(expiringPlan.expiresAt);
    await held.release();
    await rejection;
    await absent(join(root, "expired.txt"));
    await absent(join(root, ".aurora/lifecycle-lock"));
  } finally {
    ProjectLifecycleLock.acquire = acquire;
    if (held?.isHeld) await held.release();
    await contender.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("dry runs remain read-only and never acquire or create lifecycle authority", async () => {
  const root = await fixture();
  const acquire = ProjectLifecycleLock.acquire;
  try {
    const plan = await planFor(root, "nested/fresh.txt");
    ProjectLifecycleLock.acquire = async () => { throw new Error("Dry run must not acquire"); };
    const report = await service().apply(plan, root, { approved: false, dryRun: true });
    assert.equal(report.status, "dry-run");
    assert.deepEqual(await readdir(root), []);
  } finally {
    ProjectLifecycleLock.acquire = acquire;
    await rm(root, { recursive: true, force: true });
  }
});

test("approval, identity, expiry, executor, content digest, and lifecycle-path rejection precede lock mutation", async () => {
  const root = await fixture();
  const otherRoot = await fixture();
  const acquire = ProjectLifecycleLock.acquire;
  try {
    const plan = await planFor(root);
    let acquired = 0;
    ProjectLifecycleLock.acquire = async () => { acquired++; throw new Error("Invalid input must not acquire"); };
    const cases = [
      [plan, root, { approved: false }, ErrorCodes.OPERATION_APPROVAL_REQUIRED],
      [plan, otherRoot, { approved: true }, ErrorCodes.INVALID_OPERATION_PLAN],
      [plan, root, { approved: true }, ErrorCodes.OPERATION_PLAN_EXPIRED, Date.parse(plan.expiresAt)],
      [{ ...plan, operations: [{ id: "op-001", kind: "policy.check", description: "Unsupported executor", risk: "low", policyId: "test", requirement: "No enabled executor" }] }, root, { approved: true }, ErrorCodes.INVALID_OPERATION_PLAN],
      [{ ...plan, operations: [{ ...plan.operations[0], content: "altered\n" }] }, root, { approved: true }, ErrorCodes.INVALID_OPERATION_PLAN],
      [{ ...plan, schemaVersion: 99 }, root, { approved: true }, ErrorCodes.INVALID_OPERATION_PLAN],
    ];
    for (const [candidate, target, options, code, now = NOW] of cases) {
      await assert.rejects(service(() => now).apply(candidate, target, options), { code });
    }
    for (const path of [".aurora", ".aurora/lifecycle-lock", ".aurora/lifecycle-lock/child", ".aurora/.lifecycle-lock-candidate-owned", ".aurora/.lifecycle-lock-release-owned", ".aurora/.lifecycle-lock-reclaim-owned", ".aurora/lifecycle-journal", ".aurora/LIFECYCLE-JOURNAL/child", ".aurora/operation-journal", ".aurora/OPERATION-JOURNAL/child"]) {
      const candidate = { ...plan, operations: [{ ...plan.operations[0], path }] };
      await assert.rejects(service().apply(candidate, root, { approved: true }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    }
    assert.equal(acquired, 0);
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await readdir(otherRoot), []);
  } finally {
    ProjectLifecycleLock.acquire = acquire;
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
});

test("an interrupted package journal appearing after planning blocks writes without recovering or deleting it", async () => {
  const root = await fixture();
  let held;
  try {
    const plan = await planFor(root);
    held = await ProjectLifecycleLock.acquire(root);
    const journal = await new LifecycleJournalStore(root).create({ operation: "install", packageIds: ["test-package"], timestamp: new Date(NOW).toISOString() });
    const journalPath = join(root, ".aurora/lifecycle-journal", journal.transactionId, "journal.json");
    const original = await readFile(journalPath);
    await held.release();
    await assert.rejects(service().apply(plan, root, { approved: true }), error => {
      assert.equal(error.code, ErrorCodes.INVALID_OPERATION_PLAN);
      assert.match(error.message, /blocked.*lifecycle recovery metadata/u);
      return true;
    });
    assert.deepEqual(await readFile(journalPath), original);
    await absent(join(root, "fresh.txt"));
    await absent(join(root, ".aurora/lifecycle-lock"));
  } finally {
    if (held?.isHeld) await held.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed, ambiguous, wrong-root, missing, and excessive journal metadata fail closed before writes", async () => {
  for (const kind of ["malformed", "duplicate-key", "invalid-utf8", "wrong-root", "missing", "excessive"]) {
    const root = await fixture();
    let held;
    try {
      const plan = await planFor(root);
      const directory = join(root, ".aurora/lifecycle-journal");
      held = await ProjectLifecycleLock.acquire(root);
      const journal = await new LifecycleJournalStore(root).create({ operation: "install", packageIds: ["test-package"], timestamp: new Date(NOW).toISOString() });
      const path = join(directory, journal.transactionId, "journal.json");
      if (kind === "excessive") {
        await writeFile(path, serializeLifecycleJournalEnvelope({ ...journal, phase: "committed" }));
        await Promise.all(Array.from({ length: 128 }, async () => {
          const transactionId = randomUUID();
          const target = join(directory, transactionId);
          await mkdir(target);
          await writeFile(join(target, "journal.json"), serializeLifecycleJournalEnvelope({ ...journal, transactionId, phase: "committed" }));
        }));
      } else {
        if (kind === "malformed") await writeFile(path, "{invalid");
        if (kind === "duplicate-key") {
          const ambiguous = serializeLifecycleJournalEnvelope({ ...journal, phase: "committed" })
            .replace('"phase": "committed"', '"phase": "prepared", "phase": "committed"');
          assert.equal(parseLifecycleJournalEnvelope(JSON.parse(ambiguous)).phase, "committed");
          await writeFile(path, ambiguous);
        }
        if (kind === "invalid-utf8") {
          const encoded = Buffer.from(serializeLifecycleJournalEnvelope({
            ...journal, phase: "committed", files: [{ kind: "absent", path: "encoded-\ufffd.txt" }],
          }));
          const replacement = Buffer.from("\ufffd");
          const index = encoded.indexOf(replacement);
          assert.notEqual(index, -1);
          const malformed = Buffer.concat([encoded.subarray(0, index), Buffer.from([0xff]), encoded.subarray(index + replacement.length)]);
          assert.equal(parseLifecycleJournalEnvelope(JSON.parse(malformed.toString("utf8"))).phase, "committed");
          await writeFile(path, malformed);
        }
        if (kind === "wrong-root") await writeFile(path, serializeLifecycleJournalEnvelope({ ...journal, phase: "committed", projectRootSha256: "0".repeat(64) }));
        if (kind === "missing") await rm(path);
      }
      await held.release();
      await assert.rejects(service().apply(plan, root, { approved: true }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
      await absent(join(root, "fresh.txt"));
      await absent(join(root, ".aurora/lifecycle-lock"));
    } finally {
      if (held?.isHeld) await held.release();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("valid committed journal metadata does not block a new operation plan", async () => {
  const root = await fixture();
  let held;
  try {
    const plan = await planFor(root);
    held = await ProjectLifecycleLock.acquire(root);
    const journal = await new LifecycleJournalStore(root).create({ operation: "install", packageIds: ["test-package"], timestamp: new Date(NOW).toISOString() });
    const path = join(root, ".aurora/lifecycle-journal", journal.transactionId, "journal.json");
    const committed = serializeLifecycleJournalEnvelope({ ...journal, phase: "committed" });
    await writeFile(path, committed);
    await held.release();
    assert.equal((await service().apply(plan, root, { approved: true })).status, "applied");
    assert.equal(await readFile(path, "utf8"), committed);
    assert.equal(await readFile(join(root, "fresh.txt"), "utf8"), "winner\n");
  } finally {
    if (held?.isHeld) await held.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("lock failures have stable errors and release failure preserves any primary failure", async () => {
  const root = await fixture();
  const acquire = ProjectLifecycleLock.acquire;
  try {
    const plan = await planFor(root);
    ProjectLifecycleLock.acquire = async () => { throw new Error("Private lock diagnostic"); };
    await assert.rejects(service().apply(plan, root, { approved: true }), error => {
      assert.equal(error.code, ErrorCodes.INVALID_OPERATION_PLAN);
      assert.doesNotMatch(error.message, /Private lock diagnostic/u);
      return true;
    });
    assert.deepEqual(await readdir(root), []);

    ProjectLifecycleLock.acquire = async function (...args) {
      const lock = await acquire.apply(this, args);
      const release = lock.release;
      lock.release = async function () {
        await release.call(this);
        throw new Error("Injected release failure");
      };
      return lock;
    };
    await assert.rejects(service().apply(plan, root, { approved: true }), error => {
      assert.equal(error.code, ErrorCodes.INVALID_OPERATION_PLAN);
      assert.match(error.message, /could not release/u);
      assert.equal(error.cause.message, "Injected release failure");
      return true;
    });
    assert.equal(await readFile(join(root, "fresh.txt"), "utf8"), "winner\n");
    await assert.rejects(service().apply(plan, root, { approved: true }), error => {
      assert.equal(error.code, ErrorCodes.INVALID_OPERATION_PLAN);
      assert.ok(error.cause instanceof AggregateError);
      assert.equal(error.cause.errors[0].code, ErrorCodes.OPERATION_PLAN_DRIFT);
      assert.equal(error.cause.errors[1].message, "Injected release failure");
      return true;
    });
    assert.equal(await readFile(join(root, "fresh.txt"), "utf8"), "winner\n");
    await absent(join(root, ".aurora/lifecycle-lock"));
  } finally {
    ProjectLifecycleLock.acquire = acquire;
    await rm(root, { recursive: true, force: true });
  }
});
