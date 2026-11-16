import {
  askProjectName,
} from "../prompts/projectName.js";

import {
  askFramework,
} from "../prompts/framework.js";

import {
  askLanguage,
} from "../prompts/language.js";

import {
  askPackageManager,
} from "../prompts/packageManager.js";

import {
  askConfirmation,
} from "../prompts/confirm.js";

import {
  createProject,
  previewProjectCreation,
} from "../services/project.js";

import {
  getFrameworkDisplayName,
} from "../services/frameworks.js";

import type {
  ProjectConfig,
} from "../types/project.js";

export interface InitOptions {
  readonly dryRun?: boolean;
}

export async function initCommand(options: InitOptions = {}):
  Promise<void> {
  console.clear();

  console.log(
    "======================================="
  );

  console.log(
    options.dryRun ? "        Aurora Project Wizard (dry run)" : "        Aurora Project Wizard"
  );

  console.log(
    "======================================="
  );

  console.log("");

  const config: ProjectConfig = {
    projectName:
      await askProjectName(),

    framework:
      await askFramework(),

    language:
      await askLanguage(),

    packageManager:
      await askPackageManager(),

    installDependencies:
      await askConfirmation(
        "Install dependencies?"
      ),

    initializeGit:
      await askConfirmation(
        "Initialize Git repository?"
      ),
  };

  console.log("");
  console.log(
    "======================================="
  );

  console.log("Project Summary");

  console.log(
    "======================================="
  );

  console.log(
    `Project Name    : ${config.projectName}`
  );

  const frameworkName =
    await getFrameworkDisplayName(
      config.framework
    );

  console.log(
    `Framework       : ${frameworkName}`
  );

  console.log(
    `Language        : ${config.language}`
  );

  console.log(
    `Package Manager : ${config.packageManager}`
  );

  console.log(
    `Install Dependencies : ${
      config.installDependencies
        ? "Yes"
        : "No"
    }`
  );

  console.log(
    `Initialize Git       : ${
      config.initializeGit
        ? "Yes"
        : "No"
    }`
  );

  if (options.dryRun) {
    const preview = await previewProjectCreation(config);
    console.log(`Destination      : ${preview.root}`);
    console.log("Starter files (before dependency installation or Git setup):");
    for (const file of preview.files) console.log(`  ${file}`);
    console.log("Dry run complete. No files were written, no dependencies installed, and Git was not changed.");
    return;
  }

  await createProject(config);

  console.log("");
  console.log(
    "🎉 Aurora project initialized successfully."
  );
}
