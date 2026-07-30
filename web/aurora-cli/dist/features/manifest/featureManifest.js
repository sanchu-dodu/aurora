import fs from "fs-extra";
import path from "path";
async function manifestPath(projectPath) {
    const aurora = path.join(projectPath, ".aurora");
    await fs.ensureDir(aurora);
    return path.join(aurora, "features.json");
}
export async function loadManifest(projectPath) {
    const file = await manifestPath(projectPath);
    if (!(await fs.pathExists(file))) {
        return {
            installed: [],
        };
    }
    return fs.readJson(file);
}
export async function saveManifest(projectPath, manifest) {
    const file = await manifestPath(projectPath);
    await fs.writeJson(file, manifest, {
        spaces: 2,
    });
}
export async function isInstalled(projectPath, featureId) {
    const manifest = await loadManifest(projectPath);
    return manifest.installed.includes(featureId);
}
export async function addInstalledFeature(projectPath, featureId) {
    const manifest = await loadManifest(projectPath);
    if (!manifest.installed.includes(featureId)) {
        manifest.installed.push(featureId);
    }
    await saveManifest(projectPath, manifest);
}
//# sourceMappingURL=featureManifest.js.map