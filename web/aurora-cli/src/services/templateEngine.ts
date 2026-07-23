import fs from "fs-extra";
import path from "path";

import type { ProjectConfig } from "../types/project.js";

import { getTemplateDirectory } from "../engine/registry.js";
import { replaceVariables } from "../engine/variables.js";
import { walkDirectory } from "./walker.js";

export async function copyTemplate(
  projectPath: string,
  config: ProjectConfig
): Promise<void> {
  const templateDirectory = getTemplateDirectory(config);

  const templatePath = path.join(
    process.cwd(),
    "templates",
    templateDirectory
  );

  const files = await walkDirectory(templatePath);



  for (const source of files) {
    const relativePath = path.relative(templatePath, source);
    const destination = path.join(projectPath, relativePath);

    await fs.ensureDir(path.dirname(destination));

    let content = await fs.readFile(source, "utf8");

    content = replaceVariables(content, config);

    

await fs.writeFile(destination, content);
  }
}