import { askProjectName } from "../prompts/projectName.js";
import { askFramework } from "../prompts/framework.js";
import { askLanguage } from "../prompts/language.js";
import { askPackageManager } from "../prompts/packageManager.js";
import { createProject } from "../services/project.js";
import type { ProjectConfig } from "../types/project.js";

export async function initCommand(): Promise<void> {
  console.clear();

  console.log("=======================================");
  console.log("        Aurora Project Wizard");
  console.log("=======================================");
  console.log("");

  const config: ProjectConfig = {
    projectName: await askProjectName(),
    framework: await askFramework(),
    language: await askLanguage(),
    packageManager: await askPackageManager(),
  };

  console.log("");
  console.log("=======================================");
  console.log("Project Summary");
  console.log("=======================================");
  console.log(`Project Name    : ${config.projectName}`);
  console.log(`Framework       : ${config.framework}`);
  console.log(`Language        : ${config.language}`);
  console.log(`Package Manager : ${config.packageManager}`);

  await createProject(config);

  console.log("");
  console.log("🎉 Aurora project initialized successfully.");
}