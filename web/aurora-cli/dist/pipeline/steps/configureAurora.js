import fs from "fs-extra";
import path from "path";
export class ConfigureAuroraStep {
    projectName;
    name = "Configure Aurora";
    constructor(projectName) {
        this.projectName = projectName;
    }
    async execute() {
        const auroraDir = path.join(this.projectName, ".aurora");
        await fs.ensureDir(auroraDir);
        await fs.writeJson(path.join(auroraDir, "config.json"), {
            framework: "nextjs",
            version: "1.0.0"
        }, {
            spaces: 2
        });
    }
    async rollback() {
        const auroraDir = path.join(this.projectName, ".aurora");
        if (await fs.pathExists(auroraDir)) {
            await fs.remove(auroraDir);
            console.log("Removed Aurora configuration.");
        }
    }
}
//# sourceMappingURL=configureAurora.js.map