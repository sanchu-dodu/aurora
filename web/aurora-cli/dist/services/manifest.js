import fs from "fs-extra";
import path from "path";
export async function loadTemplateManifest(templateDirectory) {
    const manifestPath = path.join(process.cwd(), "templates", templateDirectory, "template.json");
    const exists = await fs.pathExists(manifestPath);
    if (!exists) {
        throw new Error(`Template manifest not found: ${manifestPath}`);
    }
    return fs.readJson(manifestPath);
}
//# sourceMappingURL=manifest.js.map