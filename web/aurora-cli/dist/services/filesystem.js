import fs from "fs-extra";
import path from "path";
export async function createProjectStructure(projectPath) {
    const folders = [
        "app",
        "public",
        "src",
        "src/components",
        "src/lib",
        "src/services",
        "src/types",
    ];
    for (const folder of folders) {
        await fs.ensureDir(path.join(projectPath, folder));
    }
}
//# sourceMappingURL=filesystem.js.map