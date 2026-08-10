import fs from "fs-extra";
import path from "node:path";

import type {
  ProjectConfig,
} from "../types/project.js";

import {
  getDefaultProjectTemplateRoot,
} from "../templates/projectTemplatePaths.js";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

import {
  copyTemplate,
} from "./templateEngine.js";

import {
  installDependencies,
} from "./installer.js";

import {
  initializeGit,
} from "./git.js";

export interface ProjectCreationOptions {
  workspaceRoot?: string;

  templateRoot?: string;

  dependencyInstaller?:
    typeof installDependencies;

  gitInitializer?:
    typeof initializeGit;
}

export async function createProject(
  config: ProjectConfig,
  options:
    ProjectCreationOptions = {}
): Promise<string> {
  validateProjectName(
    config.projectName
  );

  const workspaceRoot =
    path.resolve(
      options.workspaceRoot ??
      process.cwd()
    );

  const workspaceBoundary =
    new ProjectPathBoundary(
      workspaceRoot
    );

  const projectPath =
    workspaceBoundary.resolve(
      config.projectName
    );

  if (
    await fs.pathExists(
      projectPath
    )
  ) {
    throw new Error(
      `Project '${config.projectName}' already exists.`
    );
  }

  const templateRoot =
    options.templateRoot ??
    getDefaultProjectTemplateRoot();

  const dependencyInstaller =
    options.dependencyInstaller ??
    installDependencies;

  const gitInitializer =
    options.gitInitializer ??
    initializeGit;

  await fs.ensureDir(
    projectPath
  );

  const projectBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  try {
    await copyTemplate(
      projectPath,
      config,
      templateRoot
    );

    await fs.writeJson(
      projectBoundary.resolve(
        "aurora.config.json"
      ),
      config,
      {
        spaces: 2,
      }
    );

    if (
      config.installDependencies
    ) {
      await dependencyInstaller(
        projectPath,
        config.packageManager
      );
    }

    if (
      config.initializeGit
    ) {
      await gitInitializer(
        projectPath
      );
    }

    console.log("");
    console.log(
      `✅ Project created at: ${projectPath}`
    );

    return projectPath;
  } catch (error) {
    try {
      await fs.remove(
        workspaceBoundary.resolve(
          config.projectName
        )
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [
          error,
          cleanupError,
        ],
        "Project creation failed and partial output could not be safely removed."
      );
    }

    console.log("");
    console.log(
      "Removed partially created project."
    );

    throw error;
  }
}

function validateProjectName(
  projectName: string
): void {
  const normalized =
    projectName.trim();

  const validName =
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/
      .test(normalized);

  const reservedWindowsNames =
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  if (
    !validName ||
    normalized === "." ||
    normalized === ".." ||
    normalized.endsWith(".") ||
    reservedWindowsNames.test(
      normalized
    )
  ) {
    throw new Error(
      `Invalid project name '${projectName}'. Use letters, numbers, periods, underscores, or hyphens without path separators.`
    );
  }
}
