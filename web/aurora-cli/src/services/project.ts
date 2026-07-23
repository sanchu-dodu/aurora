import fs from "fs-extra";
import path from "path";

import { createProjectStructure } from "./filesystem.js";
import { createPackageJson } from "./package.js";

import type { ProjectConfig } from "../types/project.js";

export async function createProject(
  config: ProjectConfig
): Promise<void> {
  const projectPath = path.join(process.cwd(), config.projectName);

  // Create the project directory
  await fs.ensureDir(projectPath);

  // Create the folder structure
  await createProjectStructure(projectPath);

  // Create package.json
  await createPackageJson(projectPath, config);

  // Create aurora.config.json
  await fs.writeJson(
    path.join(projectPath, "aurora.config.json"),
    config,
    {
      spaces: 2,
    }
  );

  console.log("");
  console.log(`✅ Project created at: ${projectPath}`);
}