import fs from "node:fs/promises";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  durableWriteFile,
} from "../lifecycle/durableFileWriter.js";

import {
  WriteLock,
} from "../synchronization/writeLock.js";

import {
  parsePackageManifestBytes,
} from "../trust/packageManifestJson.js";

import {
  createEmptyLockFile,
  normalizeLockFile,
  parseLockFile,
  parseOfficialRegistryPackageLockEntry,
} from "./lockSchema.js";

import type {
  LockFile,
  OfficialRegistryPackageLockEntry,
} from "./lockSchema.js";

export type {
  LockFile,
  OfficialRegistryPackageLockEntry,
} from "./lockSchema.js";

function lockFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Aurora package lock verification failed: ${message}`,
    {
      code:
        ErrorCodes
          .INVALID_PACKAGE_LOCK,
      suggestion:
        "Restore aurora.lock from a trusted project revision or regenerate it from verified package inputs.",
      cause,
    }
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
    error.code === code
  );
}

export class LockManager {
  private readonly lock =
    new WriteLock();

  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  private get lockFile(): string {
    return this.pathBoundary.resolve(
      "aurora.lock"
    );
  }

  private async readUnlocked():
    Promise<LockFile> {
    let content: Buffer;

    try {
      content =
        await fs.readFile(
          this.lockFile
        );
    }
    catch (error) {
      if (isErrno(error, "ENOENT")) {
        return createEmptyLockFile();
      }

      throw lockFailure(
        "aurora.lock is unsafe or unreadable.",
        error
      );
    }

    try {
      return normalizeLockFile(
        parseLockFile(
          parsePackageManifestBytes(
            content
          )
        )
      );
    }
    catch (error) {
      throw lockFailure(
        "aurora.lock is malformed, ambiguous, or violates the strict lock schema.",
        error
      );
    }
  }

  private async writeUnlocked(
    lockFile: LockFile
  ): Promise<void> {
    let normalized:
      LockFile;

    try {
      normalized =
        normalizeLockFile(
          lockFile
        );
    }
    catch (error) {
      throw lockFailure(
        "the requested lock state violates the strict lock schema.",
        error
      );
    }

    try {
      await durableWriteFile(
        this.lockFile,
        JSON.stringify(
          normalized,
          null,
          2
        ),
        {
          mode:
            0o600,
        }
      );
    }
    catch (error) {
      throw lockFailure(
        "aurora.lock could not be published atomically.",
        error
      );
    }
  }

  async read(): Promise<LockFile> {
    return this.readUnlocked();
  }

  async write(
    lockFile: LockFile
  ): Promise<void> {
    await this.lock.acquire();

    try {
      await this.writeUnlocked(
        lockFile
      );
    }
    finally {
      this.lock.release();
    }
  }

  async register(
    packageName: string,
    version: string
  ): Promise<void> {
    await this.lock.acquire();

    try {
      const lockFile =
        await this.readUnlocked();

      lockFile.packages[packageName] =
        version;

      await this.writeUnlocked(
        lockFile
      );
    }
    finally {
      this.lock.release();
    }
  }

  async registerOfficial(
    packageName: string,
    entry:
      OfficialRegistryPackageLockEntry
  ): Promise<void> {
    let parsed:
      OfficialRegistryPackageLockEntry;

    try {
      parsed =
        parseOfficialRegistryPackageLockEntry(
          entry
        );
    }
    catch (error) {
      throw lockFailure(
        "the official registry lock entry violates the strict lock schema.",
        error
      );
    }

    if (
      parsed.packageId !==
        packageName
    ) {
      throw lockFailure(
        `official registry lock entry '${parsed.packageId}' cannot be registered as '${packageName}'.`
      );
    }

    await this.lock.acquire();

    try {
      const lockFile =
        await this.readUnlocked();

      lockFile.packages[packageName] =
        parsed;

      await this.writeUnlocked(
        lockFile
      );
    }
    finally {
      this.lock.release();
    }
  }

  // Publish a verified install plan once, without replacing existing
  // selections or silently merging a concurrently changed lock.
  async registerMissingOfficialSet(
    entries: readonly OfficialRegistryPackageLockEntry[],
    expected: LockFile
  ): Promise<void> {
    const expectedText = JSON.stringify(normalizeLockFile(expected));
    const parsed = entries.map(parseOfficialRegistryPackageLockEntry);
    if (
      parsed.length === 0 ||
      new Set(parsed.map(entry => entry.packageId)).size !== parsed.length
    ) {
      throw lockFailure("the official install set must contain unique package identities.");
    }
    await this.lock.acquire();
    try {
      const current = await this.readUnlocked();
      if (JSON.stringify(current) !== expectedText) {
        throw lockFailure("aurora.lock changed while the official install plan was being prepared.");
      }
      let changed = false;
      for (const entry of parsed) {
        const existing = current.packages[entry.packageId];
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(entry)) {
            throw lockFailure(`official install cannot replace the existing lock for '${entry.packageId}'.`);
          }
        } else {
          current.packages[entry.packageId] = entry;
          changed = true;
        }
      }
      if (changed) {
        await this.writeUnlocked(current);
      }
    } finally {
      this.lock.release();
    }
  }
}
