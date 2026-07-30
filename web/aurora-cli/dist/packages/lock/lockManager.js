import fs from "fs/promises";
import path from "path";
export class LockManager {
    projectPath;
    constructor(projectPath) {
        this.projectPath = projectPath;
    }
    get lockFile() {
        return path.join(this.projectPath, "aurora.lock");
    }
    async read() {
        try {
            const content = await fs.readFile(this.lockFile, "utf8");
            return JSON.parse(content);
        }
        catch {
            return {
                packages: {}
            };
        }
    }
    async write(lock) {
        await fs.writeFile(this.lockFile, JSON.stringify(lock, null, 2));
    }
    async register(packageName, version) {
        const lock = await this.read();
        lock.packages[packageName] = version;
        await this.write(lock);
    }
}
//# sourceMappingURL=lockManager.js.map