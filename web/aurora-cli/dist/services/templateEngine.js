import fs from "fs-extra";
import path from "path";
import { getTemplateDirectory } from "../engine/registry.js";
import { replaceVariables } from "../engine/variables.js";
import { walkDirectory } from "./walker.js";
import { loadTemplateManifest } from "./manifest.js";
import { shouldGenerateFile } from "../engine/filter.js";
import { validateTemplate } from "../engine/templateValidator.js";
export async function copyTemplate(projectPath, config) {
    const templateDirectory = getTemplateDirectory(config);
    const manifest = await loadTemplateManifest(templateDirectory);
    if (manifest.framework.toLowerCase() !==
        config.framework.toLowerCase()) {
        throw new Error(`Template '${manifest.displayName}' does not support framework '${config.framework}'.`);
    }
    if (!manifest.language.includes(config.language.toLowerCase())) {
        throw new Error(`Language '${config.language}' is not supported by '${manifest.displayName}'.`);
    }
    if (!manifest.packageManagers.includes(config.packageManager.toLowerCase())) {
        throw new Error(`Package manager '${config.packageManager}' is not supported by '${manifest.displayName}'.`);
    }
    const templatePath = path.join(process.cwd(), "templates", templateDirectory);
    await validateTemplate(templatePath);
    const files = await walkDirectory(templatePath);
    for (const source of files) {
        const relativePath = path.relative(templatePath, source);
        if (!shouldGenerateFile(relativePath, config)) {
            continue;
        }
        const processedRelativePath = replaceVariables(relativePath, config);
        const destination = path.join(projectPath, processedRelativePath);
        await fs.ensureDir(path.dirname(destination));
        let content = await fs.readFile(source, "utf8");
        content = replaceVariables(content, config);
        await fs.writeFile(destination, content);
    }
}
//# sourceMappingURL=templateEngine.js.map