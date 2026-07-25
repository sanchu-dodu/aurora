import fs from "fs-extra";
import path from "path";

import { createProjectStructure } from "./filesystem.js";
import { createPackageJson } from "./package.js";
import { createTsConfig } from "./tsconfig.js";
import { createReadme } from "./template.js";
import { copyTemplate } from "./templateEngine.js";
import { installDependencies } from "./installer.js";
import { initializeGit } from "./git.js";

import type { ProjectConfig } from "../types/project.js";

export async function createProject(
  config: ProjectConfig
): Promise<void> {
  const projectPath = path.join(process.cwd(), config.projectName);

  // Create the project directory
  await fs.ensureDir(projectPath);

  // Create folder structure
  await createProjectStructure(projectPath);
  
  // Copy template files
await copyTemplate(projectPath, config);

  // Create package.json
  await createPackageJson(projectPath, config);

  // Create tsconfig.json
  await createTsConfig(projectPath);

  // Create README.md
  await createReadme(projectPath, config);

    // Create aurora.config.json
  await fs.writeJson(
    path.join(projectPath, "aurora.config.json"),
    config,
    {
      spaces: 2,
    }
  );

  if (config.installDependencies) {
    await installDependencies(
      projectPath,
      config.packageManager
    );
  }

  if (config.initializeGit) {
    await initializeGit(projectPath);
  }

  console.log("");
  console.log(`✅ Project created at: ${projectPath}`);
}