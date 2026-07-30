import fs from "fs-extra";
export class ValidateProjectStep {
    projectPath;
    name = "Validate Project";
    constructor(projectPath) {
        this.projectPath = projectPath;
    }
    async execute() {
        if (await fs.pathExists(this.projectPath)) {
            throw new Error(`Project '${this.projectPath}' already exists.`);
        }
    }
}
//# sourceMappingURL=validateProject.js.map