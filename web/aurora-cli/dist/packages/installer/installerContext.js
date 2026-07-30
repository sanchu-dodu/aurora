import fs from "fs/promises";
import path from "path";
import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";
import { TransactionManager } from "./transactionManager.js";
export class InstallerContext {
    projectPath;
    transaction;
    config;
    env;
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.transaction =
            new TransactionManager();
        this.config =
            new ConfigContext(projectPath, this.transaction);
        this.env =
            new EnvContext(projectPath, this.transaction);
    }
    getProjectPath() {
        return this.projectPath;
    }
    log(message) {
        console.log(message);
    }
    async createFile(filePath, content) {
        const fullPath = path.join(this.projectPath, filePath);
        await fs.mkdir(path.dirname(fullPath), {
            recursive: true
        });
        await fs.writeFile(fullPath, content);
        this.transaction.recordCreatedFile(fullPath);
        console.log(`Created ${filePath}`);
    }
}
//# sourceMappingURL=installerContext.js.map