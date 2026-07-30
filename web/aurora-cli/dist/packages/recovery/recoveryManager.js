import fs from "fs/promises";
import path from "path";
export class RecoveryManager {
    projectPath;
    folder;
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.folder =
            path.join(projectPath, ".aurora", "transactions");
    }
    async findIncomplete() {
        try {
            const files = await fs.readdir(this.folder);
            const transactions = [];
            for (const file of files) {
                if (!file.endsWith(".json")) {
                    continue;
                }
                const content = await fs.readFile(path.join(this.folder, file), "utf8");
                const transaction = JSON.parse(content);
                if (transaction.status ===
                    "started") {
                    transactions.push(transaction);
                }
            }
            return transactions;
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=recoveryManager.js.map