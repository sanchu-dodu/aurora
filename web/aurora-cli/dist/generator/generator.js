import fs from "fs-extra";
import path from "path";
export class Generator {
    async generateFile(outputPath, content) {
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, content);
    }
}
//# sourceMappingURL=generator.js.map