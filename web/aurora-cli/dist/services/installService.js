import { getTemplateById } from "./templateService.js";
import { runProjectPipeline } from "./pipelineService.js";
export async function installProject(templateId, projectName) {
    const template = await getTemplateById(templateId);
    if (!template) {
        console.log(`Template '${templateId}' not found.`);
        return false;
    }
    console.log("");
    console.log(`Installing ${template.displayName}`);
    await runProjectPipeline(template.framework, projectName);
    return true;
}
//# sourceMappingURL=installService.js.map