import fs from "fs/promises";
import path from "path";
import { WriteLock } from "../synchronization/writeLock.js";

export interface CachedPackage {

  version: string;

  installedAt: string;

  checksum?: string;

  verified?: boolean;

}

export class CacheManager {

  private cacheFile: string;

  private lock = new WriteLock();

  constructor(
    private projectPath: string
  ) {

    this.cacheFile =
      path.join(
        projectPath,
        ".aurora",
        "cache.json"
      );

  }

  private async ensureCache(): Promise<void> {

    await fs.mkdir(
      path.dirname(this.cacheFile),
      {
        recursive: true
      }
    );

    try {

      await fs.access(
        this.cacheFile
      );

    } catch {

      await fs.writeFile(
        this.cacheFile,
        "{}"
      );

    }

  }

  async read(): Promise<Record<string, CachedPackage>> {

    await this.ensureCache();

    const content =
      await fs.readFile(
        this.cacheFile,
        "utf8"
      );

    return JSON.parse(content);

  }

 async write(
  cache: Record<string, CachedPackage>
): Promise<void> {

  await this.ensureCache();

  await this.lock.acquire();

  try {

    await fs.writeFile(
      this.cacheFile,
      JSON.stringify(
        cache,
        null,
        2
      )
    );

  } finally {

    this.lock.release();

  }

}

  async isInstalled(
    packageName: string
  ): Promise<boolean> {

    const cache =
      await this.read();

    return packageName in cache;

  }

  async install(

    packageName: string,

    version: string,

    checksum?: string

  ): Promise<void> {

    const cache =
      await this.read();

    cache[packageName] = {

      version,

      installedAt:
        new Date().toISOString(),

      checksum,

      verified: true

    };

    await this.write(cache);

  }

}