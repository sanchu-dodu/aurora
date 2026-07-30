import { getTemplates } from "../core/templateRegistry.js";
export async function listTemplatesCommand() {
    console.log("");
    console.log("Available Templates");
    console.log("===================");
    const templates = getTemplates();
    if (templates.length === 0) {
        console.log("No templates registered.");
        return;
    }
    for (const template of templates) {
        console.log("");
        console.log(`🚀 ${template.displayName}`);
        console.log("");
        console.log(`ID: ${template.id}`);
        console.log(`Version: ${template.version}`);
        console.log(`Description: ${template.description}`);
        console.log(`Author: ${template.author}`);
        console.log(`Framework: ${template.framework}`);
        console.log(`Tags: ${template.tags.join(", ")}`);
        console.log("-------------------");
    }
}
//# sourceMappingURL=list.js.map