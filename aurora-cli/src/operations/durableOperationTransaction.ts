import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { ProjectPathBoundary } from "../security/projectPathBoundary.js";
import { ProjectLifecycleLock } from "../packages/lifecycle/projectLifecycleLock.js";
import { durableWriteFile, syncDirectory } from "../packages/lifecycle/durableFileWriter.js";
import { parseOperationPlan, type OperationPlan, type FileWriteOperation } from "./operationPlan.js";
import {
  OPERATION_JOURNAL_ROOT,
  OPERATION_JOURNAL_MAX_BEFORE_BYTES,
  OPERATION_JOURNAL_MAX_DIRECTORIES,
  OPERATION_JOURNAL_MAX_TRANSACTIONS,
  assertNoPendingOperationJournals,
  assertOperationPlanAncestorCasing,
  hasOperationDirectoryAccess,
  compareOperationText,
  isOperationAuthorityPath,
  isOperationErrno,
  operationJournalError,
  operationJournalPath,
  operationPlanDigest,
  operationProjectFingerprint,
  operationRecoveryConflict,
  operationSha256,
  parseOperationJournal,
  parseOperationTransactionId,
  readArchivedOperationJournal,
  readOperationFile,
  readOperationJournal,
  sameOperationSnapshot,
  serializeOperationJournalEnvelope,
  serializeOperationPlan,
  type OperationFileSnapshot,
  type OperationJournal,
  type OperationJournalDirectory,
  type OperationJournalFile,
  type OperationJournalPhase,
} from "./operationJournal.js";

function drift(): AuroraError {
  return new AuroraError("Project state changed while applying the operation plan.", {
    code: ErrorCodes.OPERATION_PLAN_DRIFT,
    suggestion: "Generate and inspect a fresh operation plan from the current project.",
  });
}

async function safely<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof AuroraError &&
      (error.code === ErrorCodes.OPERATION_PLAN_DRIFT || error.code === ErrorCodes.OPERATION_RECOVERY_CONFLICT ||
        (error.code === ErrorCodes.INVALID_OPERATION_PLAN &&
          (error.message.startsWith("Operation recovery ") || error.message.startsWith("An interrupted operation plan "))))) {
      throw error;
    }
    throw operationJournalError();
  }
}

async function assertAuthority(boundary: ProjectPathBoundary, lock: ProjectLifecycleLock): Promise<void> {
  if (!(lock instanceof ProjectLifecycleLock) || !lock.isHeld || lock.projectRoot !== boundary.projectRoot) {
    throw operationJournalError("Operation recovery requires the held lifecycle lock for this project.");
  }
  const owner = await lock.readOwner();
  if (owner.token !== lock.ownerToken) throw operationJournalError("Operation recovery lock ownership changed.");
}

function resourcePath(boundary: ProjectPathBoundary, relative: string): string {
  return relative === "." ? boundary.projectRoot : boundary.resolve(relative);
}

function parentPath(relative: string): string {
  const separator = relative.lastIndexOf("/");
  return separator === -1 ? "." : relative.slice(0, separator);
}

function depth(relative: string): number { return relative === "." ? 0 : relative.split("/").length; }

async function directorySnapshot(boundary: ProjectPathBoundary, relative: string): Promise<BigIntStats | null> {
  const target = resourcePath(boundary, relative);
  let information: BigIntStats;
  try { information = await fs.lstat(target, { bigint: true }); }
  catch (error) { if (isOperationErrno(error, "ENOENT")) return null; throw error; }
  if (!information.isDirectory() || information.isSymbolicLink()) throw operationJournalError();
  return information;
}

function beforeMatches(entry: OperationJournalFile, actual: OperationFileSnapshot | null): boolean {
  return entry.before.kind === "absent" ? actual === null : actual !== null &&
    actual.sha256 === entry.before.sha256 && actual.content.length === entry.before.size && actual.mode === entry.before.mode;
}

function afterMatches(entry: OperationJournalFile, actual: OperationFileSnapshot | null): boolean {
  return actual !== null && actual.sha256 === entry.after.sha256 &&
    actual.content.length === entry.after.size && actual.mode === entry.after.mode;
}

async function liveFile(boundary: ProjectPathBoundary, entry: OperationJournalFile, recovery: boolean): Promise<OperationFileSnapshot | null> {
  try { return await readOperationFile(boundary.resolve(entry.path)); }
  catch { throw recovery ? operationRecoveryConflict() : drift(); }
}

async function liveDirectory(boundary: ProjectPathBoundary, entry: OperationJournalDirectory, recovery: boolean): Promise<BigIntStats | null> {
  try { return await directorySnapshot(boundary, entry.path); }
  catch { throw recovery ? operationRecoveryConflict() : drift(); }
}

function directoryBeforeMatches(entry: OperationJournalDirectory, actual: BigIntStats | null): boolean {
  return entry.before.kind === "absent" ? actual === null : actual !== null &&
    Number(actual.mode & 0o777n) === entry.before.mode;
}

function directoryAfterMatches(entry: OperationJournalDirectory, actual: BigIntStats | null): boolean {
  return actual !== null && Number(actual.mode & 0o777n) === entry.afterMode;
}

async function writePrivateFile(file: string, bytes: string | Uint8Array, mode: number): Promise<OperationFileSnapshot> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally { await handle?.close(); }
  await syncDirectory(path.dirname(file));
  const snapshot = await readOperationFile(file);
  if (!snapshot) throw operationJournalError();
  return snapshot;
}

async function ensureMetadataDirectory(boundary: ProjectPathBoundary, relative: string): Promise<void> {
  const target = boundary.resolve(relative);
  const before = await directorySnapshot(boundary, relative);
  if (before) return;
  await fs.mkdir(target, { recursive: false, mode: 0o700 });
  await fs.chmod(boundary.resolve(relative), 0o700);
  await syncDirectory(path.dirname(target));
  await syncDirectory(target);
}

async function persistJournal(boundary: ProjectPathBoundary, journal: OperationJournal): Promise<OperationJournal> {
  const normalized = parseOperationJournal(journal);
  await durableWriteFile(operationJournalPath(boundary, normalized.transactionId, "journal.json"),
    serializeOperationJournalEnvelope(normalized), { mode: 0o600 });
  return normalized;
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

async function transition(boundary: ProjectPathBoundary, journal: OperationJournal, phase: OperationJournalPhase): Promise<OperationJournal> {
  return persistJournal(boundary, { ...journal, phase, updatedAt: nextTimestamp(journal.updatedAt) });
}

async function assertBeforeState(boundary: ProjectPathBoundary, journal: OperationJournal): Promise<void> {
  for (const entry of journal.files) {
    if (!beforeMatches(entry, await liveFile(boundary, entry, false))) throw drift();
  }
  for (const entry of journal.directories) {
    if (!directoryBeforeMatches(entry, await liveDirectory(boundary, entry, false))) throw drift();
  }
}

async function assertAfterState(boundary: ProjectPathBoundary, journal: OperationJournal): Promise<void> {
  for (const entry of journal.files) {
    if (!afterMatches(entry, await liveFile(boundary, entry, false))) throw drift();
  }
  for (const entry of journal.directories) {
    if (!directoryAfterMatches(entry, await liveDirectory(boundary, entry, false))) throw drift();
  }
}

/**
 * Durable process-interruption recovery for the bounded file.write executor.
 * File data is synced before publication. Node cannot guarantee directory fsync
 * on Windows, so this does not promise recovery from every Windows power loss.
 */
export class DurableOperationTransaction {
  private closed = false;

  private constructor(
    private readonly boundary: ProjectPathBoundary,
    private readonly lock: ProjectLifecycleLock,
    readonly transactionId: string
  ) {}

  static async prepare(
    plan: OperationPlan, root: string, lock: ProjectLifecycleLock, timestamp = new Date().toISOString()
  ): Promise<DurableOperationTransaction> {
    return safely(async () => {
      const boundary = new ProjectPathBoundary(root);
      await assertAuthority(boundary, lock);
      await assertNoPendingOperationJournals(boundary.projectRoot);
      const validated = parseOperationPlan(plan);
      assertOperationPlanAncestorCasing(validated);
      if (validated.projectFingerprint !== operationProjectFingerprint(boundary.projectRoot)) throw operationJournalError();
      const operations: FileWriteOperation[] = [];
      const snapshots = new Map<string, OperationFileSnapshot | null>();
      const directories = new Map<string, OperationJournalDirectory>();
      const requestedDirectoryModes = new Map<string, number>();
      const parentDevices: bigint[] = [];
      let beforeBytes = 0;
      for (const operation of validated.operations) {
        if (operation.kind !== "file.write" || isOperationAuthorityPath(operation.path) ||
          operationSha256(operation.content) !== operation.contentSha256 ||
          (operation.mode !== undefined && (operation.mode & 0o400) === 0) ||
          (operation.directoryMode !== undefined && (operation.directoryMode & 0o700) !== 0o700)) {
          throw operationJournalError("Operation recovery cannot safely execute this file write or permission mode.");
        }
        operations.push(operation);
        const snapshot = await readOperationFile(boundary.resolve(operation.path));
        if ((snapshot && (snapshot.mode & 0o400) === 0) ||
            (!snapshot && operation.mode === undefined && ((0o666 & ~process.umask()) & 0o400) === 0)) {
          throw operationJournalError("Operation recovery requires owner-readable file states.");
        }
        if (operation.expected.exists
          ? !snapshot || snapshot.sha256 !== operation.expected.sha256
          : snapshot !== null) throw drift();
        snapshots.set(operation.id, snapshot);
        beforeBytes += snapshot?.content.length ?? 0;
        if (beforeBytes > OPERATION_JOURNAL_MAX_BEFORE_BYTES) throw operationJournalError();
        const immediateParent = parentPath(operation.path);
        if (operation.directoryMode !== undefined) {
          const key = immediateParent.toLowerCase();
          const previous = requestedDirectoryModes.get(key);
          if (previous !== undefined && previous !== operation.directoryMode) throw operationJournalError();
          requestedDirectoryModes.set(key, operation.directoryMode);
        }
        let parent = immediateParent;
        let nearest: BigIntStats | null = null;
        while (true) {
          const information = await directorySnapshot(boundary, parent);
          if (information) {
            if (!hasOperationDirectoryAccess(Number(information.mode & 0o777n))) throw operationJournalError();
            nearest = information;
            if (parent === immediateParent && operation.directoryMode !== undefined) {
              const key = parent.toLowerCase();
              if (!directories.has(key)) directories.set(key, {
                path: parent, before: { kind: "directory", mode: Number(information.mode & 0o777n) },
                afterMode: operation.directoryMode,
              });
            }
            break;
          }
          if (parent === ".") throw operationJournalError();
          if (((0o777 & ~process.umask()) & 0o700) !== 0o700) throw operationJournalError();
          const key = parent.toLowerCase();
          if (!directories.has(key)) directories.set(key, {
            path: parent, before: { kind: "absent" }, afterMode: 0o777 & ~process.umask(),
          });
          if (directories.size > OPERATION_JOURNAL_MAX_DIRECTORIES) throw operationJournalError();
          parent = parentPath(parent);
        }
        if (!nearest) throw operationJournalError();
        parentDevices.push(nearest.dev);
      }
      for (const [key, mode] of requestedDirectoryModes) {
        const entry = directories.get(key);
        if (!entry) throw operationJournalError();
        entry.afterMode = mode;
      }
      if (directories.size > OPERATION_JOURNAL_MAX_DIRECTORIES) throw operationJournalError();

      await ensureMetadataDirectory(boundary, OPERATION_JOURNAL_ROOT);
      // Refuse before publishing another record, rather than overflowing the
      // bounded inspector and blocking the project after a successful apply.
      const inventory = await fs.opendir(boundary.resolve(OPERATION_JOURNAL_ROOT));
      try {
        let entries = 0;
        while (await inventory.read()) {
          if (++entries >= OPERATION_JOURNAL_MAX_TRANSACTIONS) {
            throw operationJournalError("Operation recovery history has reached its bounded capacity.");
          }
        }
      } finally { await inventory.close(); }
      const transactionId = randomUUID();
      const candidateRelative = `.aurora/.operation-journal-candidate-${transactionId}`;
      const candidate = boundary.resolve(candidateRelative);
      await fs.mkdir(candidate, { mode: 0o700 });
      await fs.chmod(candidate, 0o700);
      const candidateInformation = await directorySnapshot(boundary, candidateRelative);
      if (!candidateInformation || parentDevices.some(device => device !== candidateInformation.dev)) {
        throw operationJournalError("Operation recovery requires publication on the journal filesystem.");
      }
      for (const name of ["blobs", "stages", "restore", "directories"]) {
        await fs.mkdir(boundary.resolve(`${candidateRelative}/${name}`), { mode: 0o700 });
        await fs.chmod(boundary.resolve(`${candidateRelative}/${name}`), 0o700);
      }
      await writePrivateFile(boundary.resolve(`${candidateRelative}/plan.json`), serializeOperationPlan(validated), 0o600);
      const files: OperationJournalFile[] = [];
      const savedBlobs = new Set<string>();
      for (const operation of operations) {
        const snapshot = snapshots.get(operation.id) ?? null;
        if (snapshot && !savedBlobs.has(snapshot.sha256)) {
          await writePrivateFile(boundary.resolve(`${candidateRelative}/blobs/${snapshot.sha256}.bin`), snapshot.content, 0o600);
          savedBlobs.add(snapshot.sha256);
        }
        const staged = await writePrivateFile(boundary.resolve(`${candidateRelative}/stages/${operation.id}.bin`),
          Buffer.from(operation.content), operation.mode ?? snapshot?.mode ?? (0o666 & ~process.umask()));
        files.push({
          operationId: operation.id, path: operation.path,
          before: snapshot ? { kind: "file", sha256: snapshot.sha256, size: snapshot.content.length, mode: snapshot.mode }
            : { kind: "absent" },
          after: { sha256: staged.sha256, size: staged.content.length, mode: staged.mode },
        });
      }
      const sortedDirectories = [...directories.values()].sort((left, right) => compareOperationText(left.path, right.path));
      // Measuring effective modes also handles Windows' limited chmod semantics.
      for (let index = 0; index < sortedDirectories.length; index++) {
        const entry = sortedDirectories[index]!;
        const relative = `${candidateRelative}/directories/${String(index).padStart(4, "0")}.dir`;
        const staged = boundary.resolve(relative);
        await fs.mkdir(staged, { mode: 0o700 });
        await fs.chmod(staged, entry.afterMode);
        const information = await directorySnapshot(boundary, relative);
        if (!information) throw operationJournalError();
        entry.afterMode = Number(information.mode & 0o777n);
        if (!hasOperationDirectoryAccess(entry.afterMode)) throw operationJournalError();
        await syncDirectory(staged);
      }
      const journal = parseOperationJournal({
        schemaVersion: 1, kind: "operation-plan", transactionId,
        planId: validated.id, planDigest: operationPlanDigest(validated), projectFingerprint: validated.projectFingerprint,
        phase: "preparing", createdAt: timestamp, updatedAt: timestamp, files, directories: sortedDirectories,
      });
      await writePrivateFile(boundary.resolve(`${candidateRelative}/journal.json`), serializeOperationJournalEnvelope(journal), 0o600);
      for (const name of ["blobs", "stages", "restore", "directories"]) {
        await syncDirectory(boundary.resolve(`${candidateRelative}/${name}`));
      }
      await syncDirectory(candidate);
      const destination = operationJournalPath(boundary, transactionId);
      try { await fs.lstat(destination); throw operationJournalError(); }
      catch (error) { if (!isOperationErrno(error, "ENOENT")) throw error; }
      await assertAuthority(boundary, lock);
      await fs.rename(boundary.resolve(candidateRelative), destination);
      await syncDirectory(boundary.resolve(".aurora"));
      await syncDirectory(boundary.resolve(OPERATION_JOURNAL_ROOT));
      const transaction = new DurableOperationTransaction(boundary, lock, transactionId);
      const persisted = await transaction.readJournal();
      await transition(boundary, persisted, "prepared");
      return transaction;
    });
  }

  async readJournal(): Promise<OperationJournal> {
    return safely(() => readOperationJournal(this.boundary.projectRoot, this.transactionId));
  }

  async beginMutation(): Promise<OperationJournal> {
    return safely(async () => {
      await this.assertOpenAuthority();
      const journal = await this.readJournal();
      if (journal.phase !== "prepared") throw operationJournalError();
      // A drift here leaves a prepared journal: cancellation must not undo edits.
      await assertBeforeState(this.boundary, journal);
      return transition(this.boundary, journal, "mutating");
    });
  }

  async writeOperation(operationId: string): Promise<void> {
    return safely(async () => {
      await this.assertOpenAuthority();
      const journal = await this.readJournal();
      if (journal.phase !== "mutating") throw operationJournalError();
      const entry = journal.files.find(file => file.operationId === operationId);
      if (!entry) throw operationJournalError();
      const actual = await liveFile(this.boundary, entry, false);
      const stage = await readOperationFile(operationJournalPath(this.boundary, this.transactionId, `stages/${operationId}.bin`));
      if (!stage && afterMatches(entry, actual)) return;
      if (!stage || stage.sha256 !== entry.after.sha256 || stage.mode !== entry.after.mode ||
        stage.content.length !== entry.after.size) throw operationJournalError();
      if (!beforeMatches(entry, actual)) throw drift();
      const parent = parentPath(entry.path);
      const requiredDirectories = journal.directories.filter(directory => directory.path === "." ||
        directory.path.toLowerCase() === parent.toLowerCase() ||
        parent.toLowerCase().startsWith(`${directory.path.toLowerCase()}/`))
        .sort((left, right) => depth(left.path) - depth(right.path));
      for (const directory of requiredDirectories) {
        await this.publishDirectory(journal, directory);
      }
      // The same-device check and a fresh boundary/current-state check precede rename.
      const parentInformation = await directorySnapshot(this.boundary, parent);
      if (!parentInformation || parentInformation.dev !== stage.stats.dev) throw operationJournalError();
      if (!beforeMatches(entry, await liveFile(this.boundary, entry, false))) throw drift();
      await assertAuthority(this.boundary, this.lock);
      const source = operationJournalPath(this.boundary, this.transactionId, `stages/${operationId}.bin`);
      await syncStagedFile(source, entry.after);
      const target = this.boundary.resolve(entry.path);
      if (!beforeMatches(entry, await liveFile(this.boundary, entry, false))) throw drift();
      await fs.rename(operationJournalPath(this.boundary, this.transactionId, `stages/${operationId}.bin`), target);
      await syncDirectory(resourcePath(this.boundary, parent));
      await syncDirectory(operationJournalPath(this.boundary, this.transactionId, "stages"));
    });
  }

  async beginVerification(): Promise<OperationJournal> {
    return safely(async () => {
      await this.assertOpenAuthority();
      const journal = await this.readJournal();
      if (journal.phase !== "mutating") throw operationJournalError();
      await assertAfterState(this.boundary, journal);
      return transition(this.boundary, journal, "verifying");
    });
  }

  async commitDurably(): Promise<OperationJournal> {
    return safely(async () => {
      await this.assertOpenAuthority();
      const journal = await this.readJournal();
      if (journal.phase !== "verifying") throw operationJournalError();
      await assertAfterState(this.boundary, journal);
      // If rename succeeds but its sync fails, rollback re-reads and refuses committed.
      const committed = await transition(this.boundary, journal, "committed");
      this.closed = true;
      return committed;
    });
  }

  async rollback(): Promise<OperationJournal> {
    return safely(async () => {
      await assertAuthority(this.boundary, this.lock);
      const result = await recoverOperationTransaction(this.boundary.projectRoot, this.transactionId, this.lock);
      this.closed = true;
      return result;
    });
  }

  private async assertOpenAuthority(): Promise<void> {
    if (this.closed) throw operationJournalError();
    await assertAuthority(this.boundary, this.lock);
  }

  private async publishDirectory(journal: OperationJournal, entry: OperationJournalDirectory): Promise<void> {
    const actual = await liveDirectory(this.boundary, entry, false);
    if (directoryAfterMatches(entry, actual)) return;
    if (!directoryBeforeMatches(entry, actual)) throw drift();
    await assertAuthority(this.boundary, this.lock);
    if (entry.before.kind === "directory") {
      const target = resourcePath(this.boundary, entry.path);
      if (!directoryBeforeMatches(entry, await liveDirectory(this.boundary, entry, false))) throw drift();
      await fs.chmod(target, entry.afterMode);
      await syncDirectory(target);
      return;
    }
    const index = journal.directories.findIndex(directory => directory.path === entry.path);
    const sourceRelative = `${OPERATION_JOURNAL_ROOT}/${this.transactionId}/directories/${String(index).padStart(4, "0")}.dir`;
    const sourceInformation = await directorySnapshot(this.boundary, sourceRelative);
    const parent = parentPath(entry.path);
    const parentInformation = await directorySnapshot(this.boundary, parent);
    if (!sourceInformation || Number(sourceInformation.mode & 0o777n) !== entry.afterMode ||
      !parentInformation || parentInformation.dev !== sourceInformation.dev) throw operationJournalError();
    if (await liveDirectory(this.boundary, entry, false)) throw drift();
    await assertDirectoryEmpty(this.boundary.resolve(sourceRelative), false);
    await fs.rename(this.boundary.resolve(sourceRelative), this.boundary.resolve(entry.path));
    await syncDirectory(resourcePath(this.boundary, parent));
    await syncDirectory(operationJournalPath(this.boundary, this.transactionId, "directories"));
  }
}

async function syncStagedFile(file: string, expected: { sha256: string; size: number; mode: number }): Promise<void> {
  const snapshot = await readOperationFile(file);
  if (!snapshot || snapshot.sha256 !== expected.sha256 || snapshot.mode !== expected.mode ||
    snapshot.content.length !== expected.size) throw operationJournalError();
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    if (!sameOperationSnapshot(snapshot.stats, await handle.stat({ bigint: true })) ||
      !sameOperationSnapshot(snapshot.stats, await fs.lstat(file, { bigint: true }))) throw operationJournalError();
    // Files were synced through writable handles during staging. Windows rejects
    // fsync on read-only descriptors; POSIX gets an additional pre-publication sync.
    if (process.platform !== "win32") await handle.sync();
  } finally { await handle?.close(); }
}

async function selectedJournal(root: string, id: string): Promise<{ journal: OperationJournal; archived: boolean }> {
  const boundary = new ProjectPathBoundary(root);
  parseOperationTransactionId(id);
  const archived = await readArchivedOperationJournal(root, id);
  if (archived) {
    try { await fs.lstat(operationJournalPath(boundary, id)); throw operationJournalError(); }
    catch (error) { if (!isOperationErrno(error, "ENOENT")) throw error; }
    return { journal: archived, archived: true };
  }
  const journal = await readOperationJournal(root, id);
  if (journal.phase === "committed") throw operationJournalError("Operation recovery cannot undo a committed transaction.");
  return { journal, archived: false };
}

async function assertCreatedDirectoryContents(
  boundary: ProjectPathBoundary, journal: OperationJournal, entry: OperationJournalDirectory,
  information: BigIntStats
): Promise<void> {
  // Only exact recorded child names belong to this transaction. This also
  // fails closed for case-only user renames or case-sensitive Windows folders.
  const allowed = new Set([
    ...journal.files.map(file => file.path),
    ...journal.directories.map(directory => directory.path),
  ]);
  const directory = await fs.opendir(resourcePath(boundary, entry.path));
  let count = 0;
  try {
    let child;
    while ((child = await directory.read()) !== null) {
      if (++count > journal.files.length + journal.directories.length || child.isSymbolicLink() ||
        (!child.isFile() && !child.isDirectory()) ||
        !allowed.has(`${entry.path}/${child.name}`)) throw operationRecoveryConflict();
    }
  } finally { await directory.close(); }
  const completed = await directorySnapshot(boundary, entry.path);
  if (!completed || !sameOperationSnapshot(information, completed)) throw operationRecoveryConflict();
}

async function preflightRecovery(boundary: ProjectPathBoundary, journal: OperationJournal): Promise<void> {
  if (journal.phase === "preparing" || journal.phase === "prepared") return;
  for (const entry of journal.files) {
    const actual = await liveFile(boundary, entry, true);
    if (!beforeMatches(entry, actual) && !afterMatches(entry, actual)) throw operationRecoveryConflict();
  }
  for (const entry of journal.directories) {
    const actual = await liveDirectory(boundary, entry, true);
    if (!directoryBeforeMatches(entry, actual) && !directoryAfterMatches(entry, actual)) throw operationRecoveryConflict();
    if (actual && entry.before.kind === "absent") {
      try { await assertCreatedDirectoryContents(boundary, journal, entry, actual); }
      catch { throw operationRecoveryConflict(); }
    }
  }
}

async function assertDirectoryEmpty(target: string, recovery: boolean): Promise<void> {
  const directory = await fs.opendir(target);
  try { if (await directory.read()) throw recovery ? operationRecoveryConflict() : operationJournalError(); }
  finally { await directory.close(); }
}

async function archiveRecovered(boundary: ProjectPathBoundary, journal: OperationJournal): Promise<void> {
  await ensureMetadataDirectory(boundary, `${OPERATION_JOURNAL_ROOT}/recovered`);
  const source = operationJournalPath(boundary, journal.transactionId);
  const destination = boundary.resolve(`${OPERATION_JOURNAL_ROOT}/recovered/${journal.transactionId}`);
  try { await fs.lstat(destination); throw operationJournalError(); }
  catch (error) { if (!isOperationErrno(error, "ENOENT")) throw error; }
  await fs.rename(source, destination);
  await syncDirectory(boundary.resolve(OPERATION_JOURNAL_ROOT));
  await syncDirectory(boundary.resolve(`${OPERATION_JOURNAL_ROOT}/recovered`));
}

/** Read-only preview: no lock, journal writes, project writes, or archive creation. */
export async function previewOperationRecovery(root: string, transactionId: string): Promise<OperationJournal> {
  return safely(async () => {
    const selected = await selectedJournal(root, transactionId);
    if (!selected.archived) await preflightRecovery(new ProjectPathBoundary(root), selected.journal);
    return selected.journal;
  });
}

/** Explicit rollback only. Archived IDs are safe no-ops even after later user edits. */
export async function recoverOperationTransaction(
  root: string, transactionId: string, heldLock: ProjectLifecycleLock
): Promise<OperationJournal> {
  return safely(async () => {
    const boundary = new ProjectPathBoundary(root);
    await assertAuthority(boundary, heldLock);
    const selected = await selectedJournal(boundary.projectRoot, transactionId);
    if (selected.archived) return selected.journal;
    let journal = selected.journal;
    // Validate every blob and every live resource before the first project write.
    await preflightRecovery(boundary, journal);
    if (journal.phase === "preparing" || journal.phase === "prepared") {
      await assertAuthority(boundary, heldLock);
      await archiveRecovered(boundary, journal);
      return journal;
    }
    if (journal.phase !== "recovering") journal = await transition(boundary, journal, "recovering");
    for (const entry of [...journal.files].reverse()) {
      await assertAuthority(boundary, heldLock);
      const actual = await liveFile(boundary, entry, true);
      if (beforeMatches(entry, actual)) continue;
      if (!afterMatches(entry, actual)) throw operationRecoveryConflict();
      if (entry.before.kind === "absent") {
        if (!afterMatches(entry, await liveFile(boundary, entry, true))) throw operationRecoveryConflict();
        await fs.unlink(boundary.resolve(entry.path));
        await syncDirectory(resourcePath(boundary, parentPath(entry.path)));
        continue;
      }
      const blob = await readOperationFile(operationJournalPath(boundary, transactionId, `blobs/${entry.before.sha256}.bin`));
      if (!blob || blob.sha256 !== entry.before.sha256 || blob.content.length !== entry.before.size) throw operationJournalError();
      const stage = operationJournalPath(boundary, transactionId, `restore/${entry.operationId}.bin`);
      await durableWriteFile(stage, blob.content, { mode: 0o600 });
      await setAndSyncFileMode(stage, entry.before.mode);
      await syncStagedFile(stage, entry.before);
      const stageInformation = await readOperationFile(stage);
      const parentInformation = await directorySnapshot(boundary, parentPath(entry.path));
      if (!stageInformation || !parentInformation || stageInformation.stats.dev !== parentInformation.dev) throw operationRecoveryConflict();
      if (!afterMatches(entry, await liveFile(boundary, entry, true))) throw operationRecoveryConflict();
      await fs.rename(operationJournalPath(boundary, transactionId, `restore/${entry.operationId}.bin`), boundary.resolve(entry.path));
      await syncDirectory(resourcePath(boundary, parentPath(entry.path)));
      await syncDirectory(operationJournalPath(boundary, transactionId, "restore"));
    }
    const createdDirectories = journal.directories.filter(entry => entry.before.kind === "absent")
      .sort((left, right) => depth(right.path) - depth(left.path));
    for (const entry of createdDirectories) {
      await assertAuthority(boundary, heldLock);
      const actual = await liveDirectory(boundary, entry, true);
      if (!actual) continue;
      if (!directoryAfterMatches(entry, actual)) throw operationRecoveryConflict();
      await assertDirectoryEmpty(resourcePath(boundary, entry.path), true);
      await fs.rmdir(boundary.resolve(entry.path));
      await syncDirectory(resourcePath(boundary, parentPath(entry.path)));
    }
    const originalDirectories = journal.directories.filter(entry => entry.before.kind === "directory")
      .sort((left, right) => depth(right.path) - depth(left.path));
    for (const entry of originalDirectories) {
      await assertAuthority(boundary, heldLock);
      const actual = await liveDirectory(boundary, entry, true);
      if (directoryBeforeMatches(entry, actual)) continue;
      if (!directoryAfterMatches(entry, actual) || entry.before.kind !== "directory") throw operationRecoveryConflict();
      await fs.chmod(resourcePath(boundary, entry.path), entry.before.mode);
      await syncDirectory(resourcePath(boundary, entry.path));
    }
    for (const entry of journal.files) {
      if (!beforeMatches(entry, await liveFile(boundary, entry, true))) throw operationRecoveryConflict();
    }
    for (const entry of journal.directories) {
      if (!directoryBeforeMatches(entry, await liveDirectory(boundary, entry, true))) throw operationRecoveryConflict();
    }
    await assertAuthority(boundary, heldLock);
    await archiveRecovered(boundary, journal);
    return journal;
  });
}

async function setAndSyncFileMode(file: string, mode: number): Promise<void> {
  const before = await readOperationFile(file);
  if (!before) throw operationJournalError();
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, "r+");
    if (!sameOperationSnapshot(before.stats, await handle.stat({ bigint: true })) ||
      !sameOperationSnapshot(before.stats, await fs.lstat(file, { bigint: true }))) throw operationJournalError();
    await handle.chmod(mode);
    await handle.sync();
  } finally { await handle?.close(); }
}
