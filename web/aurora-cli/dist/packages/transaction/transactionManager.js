import fs from "fs/promises";
import path from "path";
export class TransactionManager {
    projectPath;
    folder;
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.folder =
            path.join(projectPath, ".aurora", "transactions");
    }
    async ensureFolder() {
        await fs.mkdir(this.folder, {
            recursive: true
        });
    }
    async create(transaction) {
        await this.ensureFolder();
        await fs.writeFile(path.join(this.folder, `${transaction.id}.json`), JSON.stringify(transaction, null, 2));
    }
    async update(id, data) {
        await this.ensureFolder();
        const file = path.join(this.folder, `${id}.json`);
        const content = await fs.readFile(file, "utf8");
        const transaction = JSON.parse(content);
        await fs.writeFile(file, JSON.stringify({
            ...transaction,
            ...data
        }, null, 2));
    }
}
//# sourceMappingURL=transactionManager.js.map