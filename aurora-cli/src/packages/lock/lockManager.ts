import fs from "node:fs/promises";
import path from "node:path";

import { WriteLock } from "../synchronization/writeLock.js";

export interface LockFile {
  packages: Record<string, string>;
}

export class LockManager {
  private readonly lock =
    new WriteLock();

  constructor(
    private readonly projectPath: string
  ) {}

  private get lockFile(): string {
    return path.join(
      this.projectPath,
      "aurora.lock"
    );
  }

  private async readUnlocked(): Promise<LockFile> {
    try {
      const content = await fs.readFile(
        this.lockFile,
        "utf8"
      );

      return JSON.parse(content) as LockFile;
    } catch (error) {
      const code =
        (error as NodeJS.ErrnoException).code;

      if (code === "ENOENT") {
        return {
          packages: {},
        };
      }

      throw error;
    }
  }

  private async writeUnlocked(
    lockFile: LockFile
  ): Promise<void> {
    await fs.writeFile(
      this.lockFile,
      JSON.stringify(
        lockFile,
        null,
        2
      ),
      "utf8"
    );
  }

  async read(): Promise<LockFile> {
    return this.readUnlocked();
  }

  async write(
    lockFile: LockFile
  ): Promise<void> {
    await this.lock.acquire();

    try {
      await this.writeUnlocked(lockFile);
    } finally {
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

      await this.writeUnlocked(lockFile);
    } finally {
      this.lock.release();
    }
  }
}
