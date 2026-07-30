import fs from "fs-extra";
import { getFrameworkAdapter } from "../../frameworks/frameworkRegistry.js";
export class CreateProjectStep {
    context;
    name = "Create Project";
    constructor(context) {
        this.context = context;
    }
    async execute() {
        const adapter = getFrameworkAdapter(this.context.framework);
        await adapter.createProject(this.context.projectName);
    }
    async rollback() {
        if (await fs.pathExists(this.context.projectName)) {
            await fs.remove(this.context.projectName);
            console.log("Deleted project directory.");
        }
    }
}
//# sourceMappingURL=createProject.js.map