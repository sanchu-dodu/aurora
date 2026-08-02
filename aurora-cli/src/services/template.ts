import fs from "fs-extra";
import path from "path";

import type { ProjectConfig } from "../types/project.js";

export async function createReadme(
  projectPath: string,
  config: ProjectConfig
): Promise<void> {
  const templatePath = path.join(
    process.cwd(),
    "templates",
    "nextjs",
    "README.md"
  );

  let content = await fs.readFile(templatePath, "utf8");

  content = content
    .replace(/{{PROJECT_NAME}}/g, config.projectName)
    .replace(/{{FRAMEWORK}}/g, config.framework)
    .replace(/{{LANGUAGE}}/g, config.language)
    .replace(/{{PACKAGE_MANAGER}}/g, config.packageManager);

  await fs.writeFile(
    path.join(projectPath, "README.md"),
    content
  );
}