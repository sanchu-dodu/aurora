import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ErrorCodes } from "../../dist/errors/errorCodes.js";
import { OperationPlanService } from "../../dist/operations/operationPlanService.js";

const originalInode = 9007199254740992n;
const replacementInode = 9007199254740993n;
const originalTimestamp = 1700000000000000000n;
const changedTimestamp = originalTimestamp + 1n;
const timestampMilliseconds = originalTimestamp / 1000000n;

function snapshotWith(information, updates) {
  const snapshot = Object.create(Object.getPrototypeOf(information));
  Object.defineProperties(snapshot, Object.getOwnPropertyDescriptors(information));
  return Object.assign(snapshot, updates);
}

async function rejectObservationDrift(field, observation) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "aurora-operation-file-state-")));
  const target = join(root, "target.txt");
  const originalLstat = fs.lstat;
  const originalOpen = fs.open;
  const handles = [];
  const pathRequests = [];
  const descriptorRequests = [];
  let targetPathCalls = 0;
  let targetOpenCalls = 0;
  let targetContentReads = 0;
  let driftObserved = false;

  function observedSnapshot(information, bigint, drift) {
    driftObserved ||= drift;
    if (field === "ino") {
      const inode = drift ? replacementInode : originalInode;
      return snapshotWith(information, { ino: bigint ? inode : Number(inode) });
    }
    const millisecondsField = field === "mtimeNs" ? "mtimeMs" : "ctimeMs";
    return snapshotWith(information, {
      [field]: drift ? changedTimestamp : originalTimestamp,
      [millisecondsField]: bigint ? timestampMilliseconds : Number(timestampMilliseconds),
    });
  }

  try {
    await fs.writeFile(target, "existing target content\n");
    fs.lstat = async function (...args) {
      const information = await originalLstat.apply(this, args);
      if (String(args[0]) !== target) return information;
      const bigint = args[1]?.bigint === true;
      pathRequests.push(bigint);
      targetPathCalls++;
      return observedSnapshot(information, bigint, observation === "path" && targetPathCalls > 1);
    };
    fs.open = async function (...args) {
      const handle = await originalOpen.apply(this, args);
      if (String(args[0]) !== target) return handle;
      targetOpenCalls++;
      const methods = { stat: handle.stat, read: handle.read, readFile: handle.readFile };
      handles.push({ handle, methods });
      handle.stat = async function (...statArgs) {
        const information = await methods.stat.apply(this, statArgs);
        const bigint = statArgs[0]?.bigint === true;
        descriptorRequests.push(bigint);
        return observedSnapshot(information, bigint, observation === "descriptor");
      };
      for (const method of ["read", "readFile"]) {
        handle[method] = async function (...readArgs) {
          targetContentReads++;
          return methods[method].apply(this, readArgs);
        };
      }
      return handle;
    };

    await assert.rejects(new OperationPlanService().createFileWritePlan({
      projectRoot: root,
      relativePath: "target.txt",
      content: "new planned content\n",
      intent: "test.exact-file-observation",
      summary: "Reject changed target observation before reading content",
    }), { code: ErrorCodes.INVALID_OPERATION_PLAN });
    assert.equal(targetOpenCalls, 1, "the regression must exercise the held target descriptor");
    assert.equal(driftObserved, true, "the mismatching observation must actually be reached");
    assert.ok(pathRequests.length > 0);
    assert.ok(descriptorRequests.length > 0);
    assert.ok(pathRequests.every(value => value === true), "all target path snapshots must request BigInt stats");
    assert.ok(descriptorRequests.every(value => value === true), "all held-descriptor snapshots must request BigInt stats");
    assert.equal(targetContentReads, 0, "a changed target must be rejected before any content read");
    assert.equal(handles[0].handle.fd, -1, "the rejected target descriptor must be closed");
  } finally {
    fs.lstat = originalLstat;
    fs.open = originalOpen;
    for (const { handle, methods } of handles) {
      Object.assign(handle, methods);
      if (handle.fd !== -1) await handle.close();
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

for (const observation of ["descriptor", "path"]) {
  test(`plan target observation rejects a ${observation} replacement inode hidden by Number rounding before reading`, async () => {
    assert.notEqual(originalInode, replacementInode);
    assert.equal(Number(originalInode), Number(replacementInode));
    await rejectObservationDrift("ino", observation);
  });

  for (const field of ["mtimeNs", "ctimeNs"]) {
    test(`plan target observation rejects changed ${observation} ${field} with unchanged milliseconds before reading`, async () => {
      assert.notEqual(originalTimestamp, changedTimestamp);
      assert.equal(originalTimestamp / 1000000n, changedTimestamp / 1000000n);
      assert.equal(Number(originalTimestamp) / 1000000, Number(changedTimestamp) / 1000000);
      await rejectObservationDrift(field, observation);
    });
  }
}
