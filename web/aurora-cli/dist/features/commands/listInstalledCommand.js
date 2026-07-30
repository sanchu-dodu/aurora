import { loadManifest } from "../manifest/featureManifest.js";
export async function listInstalledFeatures(projectPath) {
    const manifest = await loadManifest(projectPath);
    console.log("");
    console.log("Installed Features");
    console.log("==================");
    console.log("");
    if (manifest.installed.length === 0) {
        console.log("No features installed.");
        return;
    }
    for (const feature of manifest.installed) {
        console.log(`✅ ${feature}`);
    }
}
//# sourceMappingURL=listInstalledCommand.js.map