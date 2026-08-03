import fs from "node:fs/promises";
import path from "node:path";

import { WriteLock } from "../synchronization/writeLock.js";

export interface CachedPackage {
  version: string;
  installedAt: string;
  checksum?: string;
  verified?: boolean;
}

export class CacheManager {
  private readonly cacheFile: string;

  private readonly lock =
    new WriteLock();

  constructor(
    private readonly projectPath: string
  ) {
    this.cacheFile = path.join(
      projectPath,
      ".aurora",
      "cache.json"
    );
  }

  private async ensureCache(): Promise<void> {
    await fs.mkdir(
      path.dirname(this.cacheFile),
      {
        recursive: true,
      }
    );

    try {
      await fs.access(this.cacheFile);
    } catch {
      await fs.writeFile(
        this.cacheFile,
        "{}",
        "utf8"
      );
    }
  }

  private async readUnlocked(): Promise<
    Record<string, CachedPackage>
  > {
    await this.ensureCache();

    const content = await fs.readFile(
      this.cacheFile,
      "utf8"
    );

    return JSON.parse(content) as Record<
      string,
      CachedPackage
    >;
  }

  private async writeUnlocked(
    cache: Record<string, CachedPackage>
  ): Promise<void> {
    await this.ensureCache();

    await fs.writeFile(
      this.cacheFile,
      JSON.stringify(
        cache,
        null,
        2
      ),
      "utf8"
    );
  }

  async read(): Promise<
    Record<string, CachedPackage>
  > {
    return this.readUnlocked();
  }

  async write(
    cache: Record<string, CachedPackage>
  ): Promise<void> {
    await this.lock.acquire();

    try {
      await this.writeUnlocked(cache);
    } finally {
      this.lock.release();
    }
  }

  async isInstalled(
    packageName: string
  ): Promise<boolean> {
    const cache = await this.read();

    return packageName in cache;
  }

  async install(
    packageName: string,
    version: string,
    checksum?: string
  ): Promise<void> {
    await this.lock.acquire();

    try {
      const cache =
        await this.readUnlocked();

      cache[packageName] = {
        version,
        installedAt:
          new Date().toISOString(),
        checksum,
        verified: true,
      };

      await this.writeUnlocked(cache);
    } finally {
      this.lock.release();
    }
  }
}
