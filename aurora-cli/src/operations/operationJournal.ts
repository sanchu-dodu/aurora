import { createHash } from "node:crypto";
import { constants, type BigIntStats, type Dir } from "node:fs";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { z } from "zod";

import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { ProjectPathBoundary } from "../security/projectPathBoundary.js";
import { parsePackageManifestBytes } from "../packages/trust/packageManifestJson.js";
import { normalizePlanPath, parseOperationPlan, type OperationPlan } from "./operationPlan.js";

export const OPERATION_JOURNAL_ROOT = ".aurora/operation-journal";
export const OPERATION_JOURNAL_MAX_BYTES = 1024 * 1024;
export const OPERATION_JOURNAL_MAX_FILE_BYTES = 1024 * 1024;
export const OPERATION_JOURNAL_MAX_BEFORE_BYTES = 64 * 1024 * 1024;
export const OPERATION_JOURNAL_MAX_TRANSACTIONS = 128;
export const OPERATION_JOURNAL_MAX_DIRECTORIES = 1024;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const TransactionIdSchema = z.string().regex(
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
);
const PlanIdSchema = z.string().regex(
  /^plan-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
);
const ModeSchema = z.number().int().min(0).max(0o777);
const TimestampSchema = z.string().refine(value => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
});

/** Authorities must never be writable plan targets or restoration targets. */
export function isOperationAuthorityPath(value: string): boolean {
  const lower = value.toLowerCase();
  return lower === ".aurora" ||
    lower === ".aurora/lifecycle-lock" ||
    lower.startsWith(".aurora/lifecycle-lock/") ||
    lower.startsWith(".aurora/.lifecycle-lock-") ||
    lower === OPERATION_JOURNAL_ROOT ||
    lower.startsWith(`${OPERATION_JOURNAL_ROOT}/`) ||
    lower.startsWith(".aurora/.operation-journal-candidate-") ||
    lower === ".aurora/lifecycle-journal" ||
    lower.startsWith(".aurora/lifecycle-journal/");
}

function isCanonicalResourcePath(value: string): boolean {
  try {
    return normalizePlanPath(value) === value && !isOperationAuthorityPath(value);
  } catch {
    return false;
  }
}

const ResourcePathSchema = z.string().min(1).max(4096).refine(isCanonicalResourcePath);
const DirectoryPathSchema = z.string().min(1).max(4096).refine(value =>
  value === "." || value === ".aurora" || isCanonicalResourcePath(value)
);
const ExistingFileSchema = z.object({
  kind: z.literal("file"),
  sha256: Sha256Schema,
  size: z.number().int().min(0).max(OPERATION_JOURNAL_MAX_FILE_BYTES),
  mode: ModeSchema,
}).strict();
const AbsentSchema = z.object({ kind: z.literal("absent") }).strict();
const AfterFileSchema = z.object({
  sha256: Sha256Schema,
  size: z.number().int().min(0).max(OPERATION_JOURNAL_MAX_FILE_BYTES),
  mode: ModeSchema,
}).strict();

export const OperationJournalPhaseSchema = z.enum([
  "preparing", "prepared", "mutating", "verifying", "recovering", "committed",
]);

export const OperationJournalSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("operation-plan"),
  transactionId: TransactionIdSchema,
  planId: PlanIdSchema,
  planDigest: Sha256Schema,
  projectFingerprint: Sha256Schema,
  phase: OperationJournalPhaseSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  files: z.array(z.object({
    operationId: z.string().regex(/^op-[0-9]{3,6}$/u),
    path: ResourcePathSchema,
    before: z.discriminatedUnion("kind", [AbsentSchema, ExistingFileSchema]),
    after: AfterFileSchema,
  }).strict()).min(1).max(100),
  directories: z.array(z.object({
    path: DirectoryPathSchema,
    before: z.discriminatedUnion("kind", [
      AbsentSchema,
      z.object({ kind: z.literal("directory"), mode: ModeSchema }).strict(),
    ]),
    afterMode: ModeSchema,
  }).strict()).max(OPERATION_JOURNAL_MAX_DIRECTORIES),
}).strict().superRefine((journal, context) => {
  const invalid = (): void => {
    context.addIssue({ code: "custom", message: "Invalid operation recovery inventory." });
  };
  if (Date.parse(journal.updatedAt) < Date.parse(journal.createdAt)) invalid();
  const filePaths = new Set<string>();
  const operationIds = new Set<string>();
  let beforeBytes = 0;
  for (const file of journal.files) {
    const lower = file.path.toLowerCase();
    if (filePaths.has(lower) || operationIds.has(file.operationId)) invalid();
    filePaths.add(lower);
    operationIds.add(file.operationId);
    if (file.before.kind === "file") beforeBytes += file.before.size;
  }
  if (beforeBytes > OPERATION_JOURNAL_MAX_BEFORE_BYTES) invalid();
  const directoryPaths = new Set<string>();
  for (const directory of journal.directories) {
    const lower = directory.path.toLowerCase();
    if (directoryPaths.has(lower) || filePaths.has(lower)) invalid();
    if (lower === "." && directory.before.kind !== "directory") invalid();
    directoryPaths.add(lower);
  }
  const resourcePaths = [...filePaths, ...directoryPaths];
  for (const filePath of filePaths) {
    if (resourcePaths.some(other => other.startsWith(`${filePath}/`))) invalid();
  }
  for (const directory of journal.directories) {
    const prefix = directory.path === "." ? "" : `${directory.path.toLowerCase()}/`;
    if (!journal.files.some(file => file.path.toLowerCase().startsWith(prefix))) invalid();
  }
});

export type OperationJournal = z.infer<typeof OperationJournalSchema>;
export type OperationJournalPhase = OperationJournal["phase"];
export type OperationJournalFile = OperationJournal["files"][number];
export type OperationJournalDirectory = OperationJournal["directories"][number];
export interface OperationJournalSummary {
  readonly transactionId: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly phase: OperationJournalPhase;
}

const EnvelopeSchema = z.object({ digest: Sha256Schema, journal: OperationJournalSchema }).strict();

export function operationJournalError(message = "Operation recovery metadata is invalid or unsafe."): AuroraError {
  return new AuroraError(message, {
    code: ErrorCodes.INVALID_OPERATION_PLAN,
    suggestion: "Inspect operation recovery metadata before retrying.",
  });
}

export function operationRecoveryConflict(): AuroraError {
  return new AuroraError("Operation recovery conflicts with current project state.", {
    code: ErrorCodes.OPERATION_RECOVERY_CONFLICT,
    suggestion: "Preserve your edits and resolve the conflict before retrying operation recovery.",
  });
}

export function operationSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function operationProjectFingerprint(root: string): string {
  return operationSha256(process.platform === "win32" ? root.toLowerCase() : root);
}

/** Node on Windows exposes the readonly bit rather than arbitrary POSIX modes. */
export function effectiveOperationMode(mode: number, _directory = false): number {
  if (process.platform !== "win32") return mode;
  // Windows stat exposes only read/write bits for both files and directories.
  return (mode & 0o200) !== 0 ? 0o666 : 0o444;
}

export function hasOperationDirectoryAccess(mode: number): boolean {
  const required = process.platform === "win32" ? 0o600 : 0o700;
  return (mode & required) === required;
}

export function compareOperationText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function serializeOperationPlan(plan: OperationPlan): string {
  return `${JSON.stringify(parseOperationPlan(plan))}\n`;
}

export function operationPlanDigest(plan: OperationPlan): string {
  return operationSha256(serializeOperationPlan(plan));
}

/** Keep parent inventories portable without coalescing distinct POSIX paths. */
export function assertOperationPlanAncestorCasing(plan: OperationPlan): void {
  const ancestors = new Map<string, string>();
  for (const operation of plan.operations) {
    if (operation.kind !== "file.write") continue;
    const segments = operation.path.split("/");
    for (let length = 1; length < segments.length; length++) {
      const ancestor = segments.slice(0, length).join("/");
      const key = ancestor.toLowerCase();
      const previous = ancestors.get(key);
      if (previous !== undefined && previous !== ancestor) {
        throw operationJournalError("Operation recovery requires consistent ancestor path casing.");
      }
      ancestors.set(key, ancestor);
    }
  }
}

export function parseOperationTransactionId(value: string): string {
  try { return TransactionIdSchema.parse(value); }
  catch { throw operationJournalError(); }
}

export function parseOperationJournal(value: unknown): OperationJournal {
  try {
    const journal = OperationJournalSchema.parse(value);
    return {
      ...journal,
      files: [...journal.files].sort((left, right) => compareOperationText(left.operationId, right.operationId)),
      directories: [...journal.directories].sort((left, right) => compareOperationText(left.path, right.path)),
    };
  } catch { throw operationJournalError(); }
}

export function serializeOperationJournalEnvelope(value: unknown): string {
  const journal = parseOperationJournal(value);
  const digest = operationSha256(`${JSON.stringify(journal)}\n`);
  const serialized = `${JSON.stringify({ digest, journal }, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > OPERATION_JOURNAL_MAX_BYTES) throw operationJournalError();
  return serialized;
}

export interface OperationFileSnapshot {
  readonly content: Buffer;
  readonly stats: BigIntStats;
  readonly mode: number;
  readonly sha256: string;
}

export function sameOperationIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function sameOperationSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return sameOperationIdentity(left, right) && left.size === right.size &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function assertStableRegularFile(information: BigIntStats, maximumBytes: number): void {
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1n ||
    information.size > BigInt(maximumBytes)) throw operationJournalError();
}

/** Exact nanosecond/BigInt identity checks, bounded reads, and no symlink/FIFO opens. */
export async function readOperationFile(
  file: string, maximumBytes = OPERATION_JOURNAL_MAX_FILE_BYTES
): Promise<OperationFileSnapshot | null> {
  let before: BigIntStats;
  try { before = await fs.lstat(file, { bigint: true }); }
  catch (error) {
    if (isOperationErrno(error, "ENOENT")) return null;
    throw operationJournalError();
  }
  assertStableRegularFile(before, maximumBytes);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = await handle.stat({ bigint: true });
    const openedPath = await fs.lstat(file, { bigint: true });
    assertStableRegularFile(opened, maximumBytes);
    if (!sameOperationSnapshot(before, opened) || !sameOperationSnapshot(before, openedPath)) {
      throw operationJournalError();
    }
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const completedPath = await fs.lstat(file, { bigint: true });
    if (BigInt(length) !== before.size || length > maximumBytes ||
      !sameOperationSnapshot(before, completed) || !sameOperationSnapshot(before, completedPath)) {
      throw operationJournalError();
    }
    const content = buffer.subarray(0, length);
    return { content, stats: before, mode: Number(before.mode & 0o777n), sha256: operationSha256(content) };
  } catch { throw operationJournalError(); }
  finally { await handle?.close(); }
}

function readOperationFileSync(file: string, maximumBytes: number): OperationFileSnapshot {
  let descriptor: number | undefined;
  try {
    const before = fsSync.lstatSync(file, { bigint: true });
    assertStableRegularFile(before, maximumBytes);
    descriptor = fsSync.openSync(file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = fsSync.fstatSync(descriptor, { bigint: true });
    const openedPath = fsSync.lstatSync(file, { bigint: true });
    if (!sameOperationSnapshot(before, opened) || !sameOperationSnapshot(before, openedPath)) {
      throw operationJournalError();
    }
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fsSync.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (BigInt(length) !== before.size || length > maximumBytes ||
      !sameOperationSnapshot(before, fsSync.fstatSync(descriptor, { bigint: true })) ||
      !sameOperationSnapshot(before, fsSync.lstatSync(file, { bigint: true }))) throw operationJournalError();
    const content = buffer.subarray(0, length);
    return { content, stats: before, mode: Number(before.mode & 0o777n), sha256: operationSha256(content) };
  } catch { throw operationJournalError(); }
  finally { if (descriptor !== undefined) fsSync.closeSync(descriptor); }
}

export function isOperationErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function decodeJournal(
  boundary: ProjectPathBoundary, id: string, header: Uint8Array, planBytes: Uint8Array
): OperationJournal {
  const envelope = EnvelopeSchema.parse(parsePackageManifestBytes(header));
  const journal = parseOperationJournal(envelope.journal);
  if (envelope.digest !== operationSha256(`${JSON.stringify(journal)}\n`) ||
    journal.transactionId !== id ||
    journal.projectFingerprint !== operationProjectFingerprint(boundary.projectRoot)) throw operationJournalError();
  const plan = parseOperationPlan(parsePackageManifestBytes(planBytes));
  assertOperationPlanAncestorCasing(plan);
  if (plan.id !== journal.planId || plan.projectFingerprint !== journal.projectFingerprint ||
    operationPlanDigest(plan) !== journal.planDigest || plan.operations.length !== journal.files.length) {
    throw operationJournalError();
  }
  const requestedDirectoryModes = new Map<string, number>();
  const neededDirectories = new Map<string, string>();
  for (const operation of plan.operations) {
    if (operation.kind !== "file.write" || isOperationAuthorityPath(operation.path)) throw operationJournalError();
    const entry = journal.files.find(file => file.operationId === operation.id);
    if (!entry || entry.path !== operation.path || entry.after.sha256 !== operation.contentSha256 ||
      entry.after.sha256 !== operationSha256(operation.content) ||
      entry.after.size !== Buffer.byteLength(operation.content) || (entry.after.mode & 0o400) === 0 ||
      (operation.mode !== undefined && ((operation.mode & 0o400) === 0 ||
        entry.after.mode !== effectiveOperationMode(operation.mode))) ||
      (operation.mode === undefined && entry.before.kind === "file" && entry.after.mode !== entry.before.mode) ||
      (entry.before.kind === "file" && (entry.before.mode & 0o400) === 0) ||
      (operation.expected.exists
        ? entry.before.kind !== "file" || entry.before.sha256 !== operation.expected.sha256
        : entry.before.kind !== "absent")) throw operationJournalError();
    const parent = operation.path.includes("/") ? operation.path.slice(0, operation.path.lastIndexOf("/")) : ".";
    let ancestor = parent;
    while (true) {
      neededDirectories.set(ancestor.toLowerCase(), ancestor);
      if (ancestor === ".") break;
      ancestor = ancestor.includes("/") ? ancestor.slice(0, ancestor.lastIndexOf("/")) : ".";
    }
    if (operation.directoryMode !== undefined) {
      if ((operation.directoryMode & 0o700) !== 0o700) throw operationJournalError();
      const previous = requestedDirectoryModes.get(parent.toLowerCase());
      if (previous !== undefined && previous !== operation.directoryMode) throw operationJournalError();
      requestedDirectoryModes.set(parent.toLowerCase(), operation.directoryMode);
      const directory = journal.directories.find(candidate => candidate.path === parent);
      if (!directory || directory.afterMode !== effectiveOperationMode(operation.directoryMode, true)) {
        throw operationJournalError();
      }
    }
  }
  for (const directory of journal.directories) {
    const lower = directory.path.toLowerCase();
    if (neededDirectories.get(lower) !== directory.path || !hasOperationDirectoryAccess(directory.afterMode) ||
      (directory.before.kind === "directory" && !hasOperationDirectoryAccess(directory.before.mode)) ||
      (directory.before.kind === "directory" && !requestedDirectoryModes.has(lower))) throw operationJournalError();
    if (directory.before.kind === "absent") {
      for (const file of journal.files.filter(candidate => candidate.path.toLowerCase().startsWith(`${lower}/`))) {
        if (file.before.kind !== "absent") throw operationJournalError();
        let parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
        while (parent.toLowerCase() !== lower) {
          const ancestor = journal.directories.find(candidate => candidate.path.toLowerCase() === parent.toLowerCase());
          if (!ancestor || ancestor.before.kind !== "absent") throw operationJournalError();
          parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : ".";
        }
      }
    }
  }
  return journal;
}

export function operationJournalPath(boundary: ProjectPathBoundary, id: string, suffix = ""): string {
  parseOperationTransactionId(id);
  return boundary.resolve(`${OPERATION_JOURNAL_ROOT}/${id}${suffix ? `/${suffix}` : ""}`);
}

export async function readOperationJournal(
  root: string, transactionId: string, options: { readonly verifyBlobs?: boolean } = {}
): Promise<OperationJournal> {
  try {
    const boundary = new ProjectPathBoundary(root);
    const id = parseOperationTransactionId(transactionId);
    const header = await readOperationFile(operationJournalPath(boundary, id, "journal.json"), OPERATION_JOURNAL_MAX_BYTES);
    const plan = await readOperationFile(operationJournalPath(boundary, id, "plan.json"), OPERATION_JOURNAL_MAX_BYTES);
    if (!header || !plan) throw operationJournalError();
    const journal = decodeJournal(boundary, id, header.content, plan.content);
    if (options.verifyBlobs !== false) {
      for (const entry of journal.files) {
        if (entry.before.kind !== "file") continue;
        const blob = await readOperationFile(operationJournalPath(boundary, id, `blobs/${entry.before.sha256}.bin`));
        if (!blob || blob.sha256 !== entry.before.sha256 || blob.content.length !== entry.before.size) {
          throw operationJournalError();
        }
      }
    }
    return journal;
  } catch { throw operationJournalError(); }
}

/** Archived IDs are terminal: validate metadata but never examine current project files. */
export async function readArchivedOperationJournal(root: string, transactionId: string): Promise<OperationJournal | null> {
  try {
    const boundary = new ProjectPathBoundary(root);
    const id = parseOperationTransactionId(transactionId);
    const prefix = `${OPERATION_JOURNAL_ROOT}/recovered/${id}`;
    let information: BigIntStats;
    try { information = await fs.lstat(boundary.resolve(prefix), { bigint: true }); }
    catch (error) { if (isOperationErrno(error, "ENOENT")) return null; throw error; }
    if (!information.isDirectory() || information.isSymbolicLink()) throw operationJournalError();
    const header = await readOperationFile(boundary.resolve(`${prefix}/journal.json`), OPERATION_JOURNAL_MAX_BYTES);
    const plan = await readOperationFile(boundary.resolve(`${prefix}/plan.json`), OPERATION_JOURNAL_MAX_BYTES);
    if (!header || !plan) throw operationJournalError();
    const journal = decodeJournal(boundary, id, header.content, plan.content);
    if (journal.phase === "committed") throw operationJournalError();
    return journal;
  } catch { throw operationJournalError(); }
}

function journalSummary(journal: OperationJournal): OperationJournalSummary {
  return { transactionId: journal.transactionId, planId: journal.planId, planDigest: journal.planDigest, phase: journal.phase };
}

function validateEntry(name: string, isDirectory: boolean, isSymbolicLink: boolean): string | null {
  if (!isDirectory || isSymbolicLink) throw operationJournalError();
  return name === "recovered" ? null : parseOperationTransactionId(name);
}

export async function listOperationJournals(root: string): Promise<readonly OperationJournalSummary[]> {
  try {
    const boundary = new ProjectPathBoundary(root);
    let directory: Dir;
    try { directory = await fs.opendir(boundary.resolve(OPERATION_JOURNAL_ROOT)); }
    catch (error) { if (isOperationErrno(error, "ENOENT")) return []; throw error; }
    const summaries: OperationJournalSummary[] = [];
    let count = 0;
    try {
      let entry;
      while ((entry = await directory.read()) !== null) {
        if (++count > OPERATION_JOURNAL_MAX_TRANSACTIONS) throw operationJournalError();
        const id = validateEntry(entry.name, entry.isDirectory(), entry.isSymbolicLink());
        boundary.resolve(`${OPERATION_JOURNAL_ROOT}/${entry.name}`);
        if (id) summaries.push(journalSummary(await readOperationJournal(root, id, { verifyBlobs: false })));
      }
    } finally { await directory.close(); }
    return summaries.sort((left, right) => compareOperationText(left.transactionId, right.transactionId));
  } catch { throw operationJournalError(); }
}

/** Pure synchronous header inspection for project doctor and lifecycle-lock acquisition. */
export function inspectOperationJournals(root: string): readonly OperationJournalSummary[] {
  try {
    const boundary = new ProjectPathBoundary(root);
    let directory: fsSync.Dir;
    try { directory = fsSync.opendirSync(boundary.resolve(OPERATION_JOURNAL_ROOT)); }
    catch (error) { if (isOperationErrno(error, "ENOENT")) return []; throw error; }
    const summaries: OperationJournalSummary[] = [];
    let count = 0;
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        if (++count > OPERATION_JOURNAL_MAX_TRANSACTIONS) throw operationJournalError();
        const id = validateEntry(entry.name, entry.isDirectory(), entry.isSymbolicLink());
        boundary.resolve(`${OPERATION_JOURNAL_ROOT}/${entry.name}`);
        if (!id) continue;
        const header = readOperationFileSync(operationJournalPath(boundary, id, "journal.json"), OPERATION_JOURNAL_MAX_BYTES);
        const plan = readOperationFileSync(operationJournalPath(boundary, id, "plan.json"), OPERATION_JOURNAL_MAX_BYTES);
        summaries.push(journalSummary(decodeJournal(boundary, id, header.content, plan.content)));
      }
    } finally { directory.closeSync(); }
    return summaries.sort((left, right) => compareOperationText(left.transactionId, right.transactionId));
  } catch { throw operationJournalError(); }
}

export async function assertNoPendingOperationJournals(root: string): Promise<void> {
  const journals = await listOperationJournals(root);
  if (journals.some(journal => journal.phase !== "committed")) {
    throw operationJournalError("An interrupted operation plan requires explicit recovery before project mutation.");
  }
}
