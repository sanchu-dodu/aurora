import { discoverTemplates } from "./discovery.js";
import { loadTemplateManifest } from "./manifest.js";
export async function getAvailableFrameworks() {
    const templates = await discoverTemplates();
    const frameworks = [];
    for (const template of templates) {
        const manifest = await loadTemplateManifest(template);
        frameworks.push({
            name: manifest.displayName,
            value: manifest.framework,
            description: manifest.description,
        });
    }
    return frameworks;
}
export async function getFrameworkDisplayName(framework) {
    const frameworks = await getAvailableFrameworks();
    const match = frameworks.find((item) => item.value === framework);
    return match?.name ?? framework;
}
//# sourceMappingURL=frameworks.js.map