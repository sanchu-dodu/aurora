import { askProjectName } from "../prompts/projectName.js";
import { askFramework } from "../prompts/framework.js";
import { askLanguage } from "../prompts/language.js";
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
  };

  console.log("");
  console.log("=======================================");
  console.log("Project Summary");
  console.log("=======================================");
  console.log(`Project Name : ${config.projectName}`);
  console.log(`Framework    : ${config.framework}`);
  console.log(`Language     : ${config.language}`);
  console.log("");
  console.log("Ready for the next step...");
}