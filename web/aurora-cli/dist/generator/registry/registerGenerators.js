import { listTemplates } from "../../templates/registry/templateRegistry.js";
import { registerGenerator } from "./generatorRegistry.js";
export function registerAllGenerators() {
    const templates = listTemplates();
    for (const template of templates) {
        registerGenerator(template.id);
    }
}
//# sourceMappingURL=registerGenerators.js.map