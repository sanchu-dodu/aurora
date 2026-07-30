import fs from "fs-extra";
import path from "path";
const templates = new Map();
export async function discoverTemplates() {
    templates.clear();
    const root = path.join(process.cwd(), "src", "templates");
    await scan(root);
}
async function scan(directory) {
    const entries = await fs.readdir(directory, {
        withFileTypes: true,
    });
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await scan(full);
            continue;
        }
        if (!entry.name.endsWith(".json")) {
            continue;
        }
        const metadata = await fs.readJson(full);
        templates.set(metadata.id, metadata);
    }
}
export function getTemplate(id) {
    const template = templates.get(id);
    if (!template) {
        throw new Error(`Unknown template: ${id}`);
    }
    return template;
}
export function listTemplates() {
    return [
        ...templates.values()
    ];
}
//# sourceMappingURL=templateRegistry.js.map