import fs from "fs-extra";
export async function loadManifest(file) {
    const content = await fs.readFile(file, "utf8");
    return JSON.parse(content);
}
//# sourceMappingURL=manifestLoader.js.map