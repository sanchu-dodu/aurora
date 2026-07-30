import fs from "fs-extra";
import path from "path";
import { runCommand } from "../../services/processService.js";
export class InitializeGitStep {
    projectName;
    name = "Initialize Git";
    constructor(projectName) {
        this.projectName = projectName;
    }
    async execute() {
        await runCommand("git", [
            "init"
        ], this.projectName);
    }
    async rollback() {
        const gitFolder = path.join(this.projectName, ".git");
        if (await fs.pathExists(gitFolder)) {
            await fs.remove(gitFolder);
            console.log("Removed Git repository.");
        }
    }
}
//# sourceMappingURL=initializeGit.js.map