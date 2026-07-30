import fs from "fs-extra";
import path from "path";
export async function readDirectory(directory) {
    const entries = await fs.readdir(directory);
    return entries.map((entry) => path.join(directory, entry));
}
export async function exists(target) {
    return fs.pathExists(target);
}
//# sourceMappingURL=filesystem.js.map