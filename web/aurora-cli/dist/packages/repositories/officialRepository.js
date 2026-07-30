import fs from "fs/promises";
import path from "path";
export class OfficialRepository {
    root;
    constructor(root = process.cwd()) {
        this.root = root;
    }
    async hasPackage(packageId) {
        try {
            await fs.access(path.join(this.root, "packages", packageId, "manifest.json"));
            return true;
        }
        catch {
            return false;
        }
    }
    async loadManifest(packageId) {
        const file = path.join(this.root, "packages", packageId, "manifest.json");
        const content = await fs.readFile(file, "utf8");
        return JSON.parse(content);
    }
    async getAllPackages() {
        const directory = path.join(this.root, "packages");
        try {
            const folders = await fs.readdir(directory, {
                withFileTypes: true
            });
            const packages = [];
            for (const folder of folders) {
                if (!folder.isDirectory()) {
                    continue;
                }
                try {
                    packages.push(await this.loadManifest(folder.name));
                }
                catch {
                    // Ignore invalid packages
                }
            }
            return packages;
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=officialRepository.js.map