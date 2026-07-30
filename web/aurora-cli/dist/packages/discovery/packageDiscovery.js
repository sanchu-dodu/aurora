import fs from "fs-extra";
import path from "path";
import { pathToFileURL } from "url";
export async function discoverPackages() {
    const packagesDir = path.join(process.cwd(), "src", "packages");
    if (!(await fs.pathExists(packagesDir))) {
        return;
    }
    const files = await fs.readdir(packagesDir);
    for (const file of files) {
        if (!file.endsWith("Package.ts")) {
            continue;
        }
        const fullPath = path.join(packagesDir, file);
        await import(pathToFileURL(fullPath).href);
    }
}
//# sourceMappingURL=packageDiscovery.js.map