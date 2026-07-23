import fs from "fs-extra";
import path from "path";
import type { ProjectConfig } from "../types/project.js";

export async function createProject(config: ProjectConfig): Promise<void> {
  const projectPath = path.join(process.cwd(), config.projectName);

  await fs.ensureDir(projectPath);

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