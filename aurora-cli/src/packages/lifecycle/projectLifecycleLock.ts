import { createHash, randomUUID } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "./durableFileWriter.js";

export const PROJECT_LIFECYCLE_LOCK_RELATIVE_PATH =
  ".aurora/lifecycle-lock";

export const PROJECT_LIFECYCLE_LOCK_SCHEMA_VERSION = 1;

export const PROJECT_LIFECYCLE_LOCK_OWNER_MAX_BYTES = 4096;

const DEFAULT_ACQUISITION_TIMEOUT_MS = 5000;
const MAX_ACQUISITION_TIMEOUT_MS = 300000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const MIN_POLL_INTERVAL_MS = 5;
const MAX_POLL_INTERVAL_MS = 1000;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_PID = 0x7fffffff;

const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const SHA256_PATTERN =
  /^[0-9a-f]{64}$/u;

const OWNER_KEYS = [
  "acquiredAt",
  "hostname",
  "pid",
  "projectRootSha256",
  "schemaVersion",
  "token",
] as const;

export interface ProjectLifecycleLockOwner {
  readonly schemaVersion:
    typeof PROJECT_LIFECYCLE_LOCK_SCHEMA_VERSION;
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly projectRootSha256: string;
  readonly acquiredAt: string;
}

export interface ProjectLifecycleLockOptions {
  readonly acquisitionTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

/**
 * Cross-process lifecycle authority for one canonical Aurora project root.
 *
 * This primitive is intentionally separate from WriteLock. WriteLock remains
 * the existing non-reentrant, process-wide serialization mechanism used by
 * package metadata stores. ProjectLifecycleLock is the outer filesystem
 * authority that later lifecycle integrations can hold across an entire
 * project mutation.
 */
export class ProjectLifecycleLock {
  private readonly pathBoundary: ProjectPathBoundary;
  private readonly projectRootSha256: string;
  private readonly localHostname: string;
  private readonly acquisitionTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly token = randomUUID();
  private held = false;
  private releasing = false;

  private constructor(
    projectPath: string,
    options: ProjectLifecycleLockOptions
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(projectPath);

    this.projectRootSha256 =
      createHash("sha256")
        .update(
          this.pathBoundary.projectRoot,
          "utf8"
        )
        .digest("hex");

    this.localHostname =
      validateHostname(hostname());

    this.acquisitionTimeoutMs =
      validateTimeout(
        options.acquisitionTimeoutMs ??
          DEFAULT_ACQUISITION_TIMEOUT_MS
      );

    this.pollIntervalMs =
      validatePollInterval(
        options.pollIntervalMs ??
          DEFAULT_POLL_INTERVAL_MS
      );
  }

  static async acquire(
    projectPath: string,
    options: ProjectLifecycleLockOptions = {}
  ): Promise<ProjectLifecycleLock> {
    const lock =
      new ProjectLifecycleLock(
        projectPath,
        options
      );

    await lock.acquireInternal();
    return lock;
  }

  get ownerToken(): string {
    return this.token;
  }

  get projectRoot(): string {
    return this.pathBoundary.projectRoot;
  }

  get isHeld(): boolean {
    return this.held;
  }

  async readOwner():
    Promise<ProjectLifecycleLockOwner> {
    const owner =
      await this.readOwnerIfPresent();

    if (!owner) {
      throw new Error(
        "Aurora project lifecycle lock is not currently held."
      );
    }

    return owner;
  }

  async release(): Promise<void> {
    if (this.releasing) {
      throw new Error(
        "Cannot release Aurora project lifecycle lock while release is already in progress."
      );
    }

    if (!this.held) {
      throw new Error(
        "Cannot release an Aurora project lifecycle lock that this instance does not hold."
      );
    }

    /*
     * Claim release authority synchronously before the first await. This
     * prevents two callers on the same instance from both validating the
     * old owner and later racing to rename the fixed authoritative path.
     */
    this.releasing = true;

    try {
      const owner =
        await this.readOwnerIfPresent();

      if (!owner) {
        this.held = false;

        throw new Error(
          "Aurora project lifecycle lock disappeared before its owner could release it."
        );
      }

      if (owner.token !== this.token) {
        throw new Error(
          "Cannot release Aurora project lifecycle lock because ownership changed."
        );
      }

      const quarantine =
        this.releaseQuarantinePath();

      try {
        await fs.rename(
          this.lockFile,
          quarantine
        );
      }
      catch (error) {
        if (isErrno(error, "ENOENT")) {
          this.held = false;

          throw new Error(
            "Aurora project lifecycle lock disappeared during release.",
            { cause: error }
          );
        }

        throw error;
      }

      /*
       * The fixed authoritative path is gone at this point. A new owner may
       * acquire immediately; cleanup below touches only this owner's unique
       * quarantine path.
       */
      this.held = false;

      await syncDirectory(
        this.lockDirectory
      );

      try {
        await fs.rm(
          quarantine,
          { force: true }
        );

        await syncDirectory(
          this.lockDirectory
        );
      }
      catch (error) {
        throw new Error(
          "Aurora project lifecycle lock was released but its quarantine file could not be cleaned up.",
          { cause: error }
        );
      }
    }
    finally {
      this.releasing = false;
    }
  }
  private get lockDirectory(): string {
    return this.pathBoundary.resolve(
      ".aurora"
    );
  }

  private get lockFile(): string {
    return this.pathBoundary.resolve(
      PROJECT_LIFECYCLE_LOCK_RELATIVE_PATH
    );
  }

  private candidatePath(): string {
    return this.pathBoundary.resolve(
      `.aurora/.lifecycle-lock-candidate-${process.pid}-${this.token}`
    );
  }

  private releaseQuarantinePath():
    string {
    return this.pathBoundary.resolve(
      `.aurora/.lifecycle-lock-release-${this.token}-${randomUUID()}`
    );
  }

  private reclaimGuardPath(
    ownerToken: string
  ): string {
    return this.pathBoundary.resolve(
      `.aurora/.lifecycle-lock-reclaim-${ownerToken}`
    );
  }

  private async acquireInternal():
    Promise<void> {
    await durableEnsureDirectory(
      this.lockDirectory
    );

    const owner =
      createOwner(
        this.token,
        this.projectRootSha256,
        this.localHostname
      );

    const candidate =
      this.candidatePath();

    /*
     * Prepare a complete, durable owner record first. The authoritative
     * lifecycle-lock path is created only by the hard-link operation below,
     * so a crash cannot expose an empty or partially written lock record.
     */
    await durableWriteFile(
      candidate,
      serializeOwner(owner),
      { mode: 0o600 }
    );

    const startedAt =
      performance.now();

    try {
      while (true) {
        if (
          await this.tryLinkCandidate(
            candidate
          )
        ) {
          return;
        }

        const currentOwner =
          await this.readOwnerIfPresent();

        if (!currentOwner) {
          continue;
        }

        if (
          await this.isDefinitelyStale(
            currentOwner
          )
        ) {
          const reclaimed =
            await this.reclaimStaleOwner(
              currentOwner
            );

          if (reclaimed) {
            continue;
          }
        }

        const elapsed =
          performance.now() -
          startedAt;

        if (
          elapsed >=
          this.acquisitionTimeoutMs
        ) {
          throw new Error(
            `Timed out after ${this.acquisitionTimeoutMs} ms waiting for the Aurora project lifecycle lock.`
          );
        }

        await delay(
          Math.min(
            this.pollIntervalMs,
            Math.max(
              0,
              this.acquisitionTimeoutMs -
                elapsed
            )
          )
        );
      }
    }
    finally {
      try {
        await fs.rm(
          candidate,
          { force: true }
        );
      }
      catch {
        /*
         * A unique candidate is never authoritative. A failed cleanup may
         * leave debris but cannot grant or steal lifecycle authority.
         */
      }
    }
  }

  private async tryLinkCandidate(
    candidate: string
  ): Promise<boolean> {
    try {
      /*
       * candidate and lifecycle-lock are siblings on the same filesystem.
       * link() is the exclusive publication step: it fails with EEXIST when
       * another owner already published the authoritative path.
       */
      await fs.link(
        candidate,
        this.lockFile
      );
    }
    catch (error) {
      if (isErrno(error, "EEXIST")) {
        return false;
      }

      throw error;
    }

    this.held = true;

    try {
      await syncDirectory(
        this.lockDirectory
      );
    }
    catch (error) {
      try {
        await this.release();
      }
      catch {
        // Preserve the primary durability failure.
      }

      throw error;
    }

    return true;
  }

  private async readOwnerIfPresent():
    Promise<
      ProjectLifecycleLockOwner |
      undefined
    > {
    let content: Buffer;

    try {
      content =
        await readStableRegularFile(
          this.lockFile,
          PROJECT_LIFECYCLE_LOCK_OWNER_MAX_BYTES
        );
    }
    catch (error) {
      if (isErrno(error, "ENOENT")) {
        return undefined;
      }

      throw error;
    }

    let decoded: unknown;

    try {
      decoded =
        JSON.parse(
          content.toString("utf8")
        );
    }
    catch (error) {
      throw new TypeError(
        "Aurora project lifecycle lock owner metadata contains invalid JSON.",
        { cause: error }
      );
    }

    return parseOwner(
      decoded,
      this.projectRootSha256
    );
  }

  private async isDefinitelyStale(
    owner: ProjectLifecycleLockOwner
  ): Promise<boolean> {
    /*
     * Foreign-host locks are never reclaimed automatically. PID identity is
     * meaningful only on the host that created the lock.
     */
    if (
      owner.hostname !==
      this.localHostname
    ) {
      return false;
    }

    return isPidDefinitelyDead(
      owner.pid
    );
  }

  private async reclaimStaleOwner(
    expectedOwner:
      ProjectLifecycleLockOwner
  ): Promise<boolean> {
    const guard =
      this.reclaimGuardPath(
        expectedOwner.token
      );

    if (
      !await tryCreateReclaimGuard(
        guard
      )
    ) {
      return false;
    }

    try {
      /*
       * Re-read after acquiring the token-specific reclaim guard. This
       * prevents a stale observation from being used against a later owner.
       */
      const current =
        await this.readOwnerIfPresent();

      if (
        !current ||
        current.token !==
          expectedOwner.token ||
        current.hostname !==
          this.localHostname ||
        !await this.isDefinitelyStale(
          current
        )
      ) {
        return false;
      }

      const staleLock =
        path.join(
          guard,
          "stale-lock"
        );

      try {
        /*
         * Moving the stale authority inside the non-empty reclaim guard
         * removes the fixed lock path atomically. A later owner can then
         * publish a fresh lock without being touched by this cleanup.
         */
        await fs.rename(
          this.lockFile,
          staleLock
        );
      }
      catch (error) {
        if (isErrno(error, "ENOENT")) {
          return false;
        }

        throw error;
      }

      await syncDirectory(
        this.lockDirectory
      );

      await fs.rm(
        staleLock,
        { force: true }
      );

      await syncDirectory(
        guard
      );

      return true;
    }
    finally {
      try {
        await fs.rmdir(
          guard
        );

        await syncDirectory(
          this.lockDirectory
        );
      }
      catch (error) {
        if (
          !isErrno(error, "ENOENT") &&
          !isErrno(error, "ENOTEMPTY")
        ) {
          throw error;
        }
      }
    }
  }
}

function createOwner(
  token: string,
  projectRootSha256: string,
  localHostname: string
): ProjectLifecycleLockOwner {
  return {
    schemaVersion:
      PROJECT_LIFECYCLE_LOCK_SCHEMA_VERSION,
    token,
    pid: process.pid,
    hostname: localHostname,
    projectRootSha256,
    acquiredAt:
      new Date().toISOString(),
  };
}

function serializeOwner(
  owner: ProjectLifecycleLockOwner
): string {
  return `${JSON.stringify(
    owner,
    null,
    2
  )}\n`;
}

function parseOwner(
  input: unknown,
  expectedProjectRootSha256: string
): ProjectLifecycleLockOwner {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner metadata must be an object."
    );
  }

  const candidate =
    input as Record<
      string,
      unknown
    >;

  const keys =
    Object.keys(candidate).sort();

  if (
    keys.length !==
      OWNER_KEYS.length ||
    OWNER_KEYS.some(
      (key, index) =>
        keys[index] !== key
    )
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner metadata contains unexpected fields."
    );
  }

  if (
    candidate.schemaVersion !==
    PROJECT_LIFECYCLE_LOCK_SCHEMA_VERSION
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner metadata has an unsupported schema version."
    );
  }

  const token =
    candidate.token;

  if (
    typeof token !== "string" ||
    !TOKEN_PATTERN.test(token)
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner token is invalid."
    );
  }

  const pid =
    candidate.pid;

  if (
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    pid > MAX_PID
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner PID is invalid."
    );
  }

  const ownerHostname =
    validateHostname(
      candidate.hostname
    );

  const projectRootSha256 =
    candidate.projectRootSha256;

  if (
    typeof projectRootSha256 !==
      "string" ||
    !SHA256_PATTERN.test(
      projectRootSha256
    ) ||
    projectRootSha256 !==
      expectedProjectRootSha256
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner is not bound to this project root."
    );
  }

  const acquiredAt =
    candidate.acquiredAt;

  if (
    typeof acquiredAt !==
      "string" ||
    !isCanonicalIsoTimestamp(
      acquiredAt
    )
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock acquisition timestamp is invalid."
    );
  }

  return {
    schemaVersion:
      PROJECT_LIFECYCLE_LOCK_SCHEMA_VERSION,
    token,
    pid,
    hostname: ownerHostname,
    projectRootSha256,
    acquiredAt,
  };
}

function validateHostname(
  value: unknown
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length >
      MAX_HOSTNAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(
      value
    )
  ) {
    throw new TypeError(
      "Aurora project lifecycle lock owner hostname is invalid."
    );
  }

  return value;
}

function validateTimeout(
  value: number
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >
      MAX_ACQUISITION_TIMEOUT_MS
  ) {
    throw new TypeError(
      `Project lifecycle lock acquisition timeout must be an integer from 0 through ${MAX_ACQUISITION_TIMEOUT_MS}.`
    );
  }

  return value;
}

function validatePollInterval(
  value: number
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <
      MIN_POLL_INTERVAL_MS ||
    value >
      MAX_POLL_INTERVAL_MS
  ) {
    throw new TypeError(
      `Project lifecycle lock polling interval must be an integer from ${MIN_POLL_INTERVAL_MS} through ${MAX_POLL_INTERVAL_MS}.`
    );
  }

  return value;
}

function isCanonicalIsoTimestamp(
  value: string
): boolean {
  const timestamp =
    Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return new Date(
    timestamp
  ).toISOString() ===
    value;
}

function isPidDefinitelyDead(
  pid: number
): boolean {
  try {
    process.kill(pid, 0);
    return false;
  }
  catch (error) {
    /*
     * ESRCH is positive evidence that this same-host PID does not exist.
     * EPERM and all other errors remain fail-closed and are treated as live
     * or unverifiable.
     */
    return isErrno(
      error,
      "ESRCH"
    );
  }
}

async function tryCreateReclaimGuard(
  guard: string
): Promise<boolean> {
  try {
    await fs.mkdir(
      guard,
      {
        recursive: false,
        mode: 0o700,
      }
    );

    await syncDirectory(
      path.dirname(guard)
    );

    return true;
  }
  catch (error) {
    if (isErrno(error, "EEXIST")) {
      /*
       * An existing guard may belong to an active reclaimer. Its emptiness
       * is not evidence of abandonment because there is a valid interval
       * between mkdir() and moving the stale lock into the guard. Fail closed
       * instead of deleting or replacing authority whose ownership is unknown.
       */
      return false;
    }

    throw error;
  }
}

async function readStableRegularFile(
  file: string,
  maxBytes: number
): Promise<Buffer> {
  let handle:
    FileHandle |
    undefined;

  try {
    handle =
      await fs.open(file, "r");

    const opened =
      await handle.stat();

    const pathInformation =
      await fs.lstat(file);

    if (
      !opened.isFile() ||
      pathInformation
        .isSymbolicLink() ||
      !pathInformation.isFile() ||
      !sameFileIdentity(
        opened,
        pathInformation
      )
    ) {
      throw new TypeError(
        "Aurora project lifecycle lock must be a regular file."
      );
    }

    if (opened.size > maxBytes) {
      throw new TypeError(
        "Aurora project lifecycle lock owner metadata exceeds the maximum supported size."
      );
    }

    const content =
      await handle.readFile();

    const completed =
      await handle.stat();

    if (
      fileChangedWhileReading(
        opened,
        completed
      )
    ) {
      throw new Error(
        "Aurora project lifecycle lock changed while its owner metadata was being read."
      );
    }

    if (
      content.byteLength >
      maxBytes
    ) {
      throw new TypeError(
        "Aurora project lifecycle lock owner metadata exceeds the maximum supported size."
      );
    }

    return content;
  }
  finally {
    await handle?.close();
  }
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function fileChangedWhileReading(
  before: Stats,
  after: Stats
): boolean {
  return (
    before.size !== after.size ||
    before.mtimeMs !==
      after.mtimeMs ||
    before.ctimeMs !==
      after.ctimeMs
  );
}

function isErrno(
  error: unknown,
  code: string
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (
      error as
        NodeJS.ErrnoException
    ).code === code
  );
}

function delay(
  milliseconds: number
): Promise<void> {
  return new Promise(
    resolve => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}
