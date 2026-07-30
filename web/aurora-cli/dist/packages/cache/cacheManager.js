import fs from "fs/promises";
import path from "path";
import { WriteLock } from "../synchronization/writeLock.js";
export class CacheManager {
    projectPath;
    cacheFile;
    lock = new WriteLock();
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.cacheFile =
            path.join(projectPath, ".aurora", "cache.json");
    }
    async ensureCache() {
        await fs.mkdir(path.dirname(this.cacheFile), {
            recursive: true
        });
        try {
            await fs.access(this.cacheFile);
        }
        catch {
            await fs.writeFile(this.cacheFile, "{}");
        }
    }
    async read() {
        await this.ensureCache();
        const content = await fs.readFile(this.cacheFile, "utf8");
        return JSON.parse(content);
    }
    async write(cache) {
        await this.ensureCache();
        await this.lock.acquire();
        try {
            await fs.writeFile(this.cacheFile, JSON.stringify(cache, null, 2));
        }
        finally {
            this.lock.release();
        }
    }
    async isInstalled(packageName) {
        const cache = await this.read();
        return packageName in cache;
    }
    async install(packageName, version, checksum) {
        const cache = await this.read();
        cache[packageName] = {
            version,
            installedAt: new Date().toISOString(),
            checksum,
            verified: true
        };
        await this.write(cache);
    }
}
//# sourceMappingURL=cacheManager.js.map