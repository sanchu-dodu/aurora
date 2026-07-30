import { installFeature } from "../installers/featureInstaller.js";
import { getFeatures } from "../registry/featureRegistry.js";
export async function featureListCommand() {
    console.log("");
    console.log("Available Features");
    console.log("==================");
    console.log("");
    for (const feature of getFeatures()) {
        console.log(`🚀 ${feature.displayName}`);
        console.log(`ID: ${feature.id}`);
        console.log(`Description: ${feature.description}`);
        console.log("");
    }
}
export async function featureInstallCommand(id, project) {
    await installFeature(id, project);
}
//# sourceMappingURL=featureCommand.js.map