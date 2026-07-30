import fs from "fs-extra";
import path from "path";
export async function walkDirectory(directory) {
    const entries = await fs.readdir(directory);
    let files = [];
    for (const entry of entries) {
        const fullPath = path.join(directory, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            const nested = await walkDirectory(fullPath);
            files.push(...nested);
        }
        else {
            files.push(fullPath);
        }
    }
    return files;
}
//# sourceMappingURL=walker.js.map