import { createHash } from "node:crypto";
import fs, { constants } from "node:fs";
import { ProjectPathBoundary } from "../security/projectPathBoundary.js";
import { parsePackageManifestBytes } from "../packages/trust/packageManifestJson.js";

export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;

/** Internal signal that a safe file would exceed the caller's remaining read budget. */
export class ProjectFileReadLimitError extends Error {
  constructor() {
    super("Project file exceeds the remaining inspection budget.");
    this.name = "ProjectFileReadLimitError";
  }
}

/** Bounded, non-executing metadata read bound to the inspected file descriptor. */
export function readProjectMetadata(boundary: ProjectPathBoundary, relative: string):
  { readonly value: unknown; readonly sha256: string } | undefined {
  const file = readProjectFile(boundary, relative);
  return file ? { value: parsePackageManifestBytes(file.bytes), sha256: file.sha256 } : undefined;
}

/** Internal byte reader: no decoding, project execution, writes, or link following. */
export function readProjectFile(boundary: ProjectPathBoundary, relative: string,
  byteLimit = MAX_PROJECT_FILE_BYTES, onRead?: (bytes: number) => void):
  { readonly bytes: Buffer; readonly sha256: string } | undefined {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 0 || byteLimit > MAX_PROJECT_FILE_BYTES) {
    throw new Error("Invalid project file read budget.");
  }
  const target = boundary.resolve(relative);
  let before: fs.BigIntStats;
  try {
    before = fs.lstatSync(target, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_PROJECT_FILE_BYTES)) {
    throw new Error("Unsafe or oversized project file.");
  }
  if (before.size > BigInt(byteLimit)) throw new ProjectFileReadLimitError();
  const fd = fs.openSync(boundary.resolve(relative),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.nlink !== 1n ||
        opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error("Project file changed while opening.");
    }
    // Never read beyond the admitted size, even if another process grows the file.
    const buffer = Buffer.alloc(Number(before.size));
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
      onRead?.(count);
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(boundary.resolve(relative), { bigint: true });
    if (BigInt(length) !== before.size || length > MAX_PROJECT_FILE_BYTES ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || after.nlink !== 1n ||
        !current.isFile() || current.nlink !== 1n || current.dev !== before.dev || current.ino !== before.ino ||
        current.size !== before.size || current.mtimeNs !== before.mtimeNs || current.ctimeNs !== before.ctimeNs) {
      throw new Error("Project file changed while reading.");
    }
    const bytes = buffer.subarray(0, length);
    return { bytes,
      sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}
