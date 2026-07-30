import fs from "fs-extra";
export async function directoryExists(path) {
    return fs.pathExists(path);
}
export async function createDirectory(path) {
    await fs.ensureDir(path);
}
export async function copyDirectory(source, destination) {
    await fs.copy(source, destination);
}
//# sourceMappingURL=fileService.js.map