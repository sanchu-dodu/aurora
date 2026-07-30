import fs from "fs/promises";
import path from "path";
export class ConfigContext {
    projectPath;
    transaction;
    constructor(projectPath, transaction) {
        this.projectPath = projectPath;
        this.transaction = transaction;
    }
    async updatePackageJson(updater) {
        const packageJsonPath = path.join(this.projectPath, "package.json");
        await this.transaction.recordModifiedFile(packageJsonPath);
        const content = await fs.readFile(packageJsonPath, "utf8");
        const json = JSON.parse(content);
        updater(json);
        await fs.writeFile(packageJsonPath, JSON.stringify(json, null, 2));
        console.log("Updated package.json");
    }
    async addDependency(packageName, version = "latest") {
        await this.updatePackageJson((json) => {
            json.dependencies ??= {};
            json.dependencies[packageName] =
                version;
        });
        console.log(`Added dependency ${packageName}`);
    }
}
//# sourceMappingURL=configContext.js.map