import { askProjectName } from "../prompts/projectName.js";
import { askFramework } from "../prompts/framework.js";
import { askLanguage } from "../prompts/language.js";
import { askPackageManager } from "../prompts/packageManager.js";
import { createProject } from "../services/project.js";
import type { ProjectConfig } from "../types/project.js";
import { getFrameworkDisplayName } from "../services/frameworks.js";
import { askConfirmation } from "../prompts/confirm.js";

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

  installDependencies: await askConfirmation(
    "Install dependencies?"
  ),

  initializeGit: await askConfirmation(
    "Initialize Git repository?"
  ),
};

  console.log("");
  console.log("=======================================");
  console.log("Project Summary");
  console.log("=======================================");
  console.log(`Project Name    : ${config.projectName}`);
  const frameworkName = await getFrameworkDisplayName(
  config.framework
);

console.log(`Framework       : ${frameworkName}`);
  console.log(`Language        : ${config.language}`);
  console.log(`Package Manager : ${config.packageManager}`);
  console.log(
  `Install Dependencies : ${
    config.installDependencies ? "Yes" : "No"
  }`
);

console.log(
  `Initialize Git       : ${
    config.initializeGit ? "Yes" : "No"
  }`
);

  try {
    await createProject(config);

    console.log("");
    console.log("🎉 Aurora project initialized successfully.");
  } catch (error) {
    console.log("");

    if (error instanceof Error) {
      console.error("❌ " + error.message);
    } else {
      console.error("❌ Unknown error occurred.");
    }
  }
}