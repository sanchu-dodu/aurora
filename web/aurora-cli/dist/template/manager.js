import { discoverTemplates } from "../services/discovery.js";
import { loadTemplateManifest } from "../services/manifest.js";
export async function getTemplates() {
    const templateNames = await discoverTemplates();
    const templates = [];
    for (const name of templateNames) {
        const manifest = await loadTemplateManifest(name);
        templates.push({
            id: manifest.framework,
            name: manifest.displayName,
            description: manifest.description,
            manifest,
        });
    }
    return templates;
}
//# sourceMappingURL=manager.js.map