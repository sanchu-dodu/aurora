import fs from "fs/promises";
import path from "path";
export class EnvContext {
    projectPath;
    transaction;
    constructor(projectPath, transaction) {
        this.projectPath = projectPath;
        this.transaction = transaction;
    }
    async addVariables(variables) {
        const file = path.join(this.projectPath, ".env.example");
        await this.transaction.recordModifiedFile(file);
        let content = "";
        try {
            content = await fs.readFile(file, "utf8");
        }
        catch {
            content = "";
        }
        for (const variable of variables) {
            if (!content.includes(`${variable}=`)) {
                content += `${variable}=\n`;
            }
        }
        await fs.writeFile(file, content);
        console.log("Updated .env.example");
    }
}
//# sourceMappingURL=envContext.js.map