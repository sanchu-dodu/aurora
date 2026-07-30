import path from "path";
import { Generator } from "./generator.js";
import { TemplateRenderer } from "./templateRenderer.js";
import { getTemplate } from "../templates/registry/templateRegistry.js";
export class ComponentGenerator {
    async generate(projectPath, componentName) {
        const renderer = new TemplateRenderer();
        const metadata = getTemplate("component");
        const template = path.join(process.cwd(), "src", "templates", metadata.framework, metadata.template);
        const content = await renderer.render(template, {
            ComponentName: componentName,
        });
        const output = path.join(projectPath, "src", "components", `${componentName}.tsx`);
        const generator = new Generator();
        await generator.generateFile(output, content);
    }
}
//# sourceMappingURL=componentGenerator.js.map