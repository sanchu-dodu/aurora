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
  getPackageManager,
} from "./packageManagerService.js";

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

  /** Suppress creation messages; subprocess output is unchanged. */
  silent?: boolean;

  /** Additional trusted starter metadata, created only if the path is absent. */
  additionalFiles?: readonly { readonly relativePath: string; readonly content: string }[];
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

  // Exclusive creation: never claim or clean up an existing project.
  await fs.mkdir(projectPath);
  const createdDirectory = await fs.lstat(projectPath, { bigint: true });
  if (!createdDirectory.isDirectory() || createdDirectory.isSymbolicLink()) {
    throw new Error("The newly created project directory changed before initialization.");
  }

  const projectBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  try {
    const generatedFiles =
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

    generatedFiles.push(
      "aurora.config.json"
    );

    for (const file of options.additionalFiles ?? []) {
      const destination = projectBoundary.resolve(file.relativePath);
      await fs.ensureDir(path.dirname(destination), { mode: 0o700 });
      await fs.writeFile(projectBoundary.resolve(file.relativePath), file.content,
        { encoding: "utf8", flag: "wx", mode: 0o600 });
      generatedFiles.push(file.relativePath);
    }

    if (
      config.installDependencies
    ) {
      await dependencyInstaller(
        projectPath,
        config.packageManager
      );

      const manager =
        getPackageManager(
          config.packageManager
        );

      for (
        const lockFile
        of manager.lockFiles
      ) {
        if (
          await fs.pathExists(
            projectBoundary.resolve(
              lockFile
            )
          )
        ) {
          generatedFiles.push(
            lockFile
          );
        }
      }
    }

    if (
      config.initializeGit
    ) {
      await gitInitializer(
        projectPath,
        generatedFiles
      );
    }

    if (!options.silent) {
      console.log("");
      console.log(`✅ Project created at: ${projectPath}`);
    }

    return projectPath;
  } catch (error) {
    try {
      const cleanupTarget = workspaceBoundary.resolve(config.projectName);
      const currentDirectory = await fs.lstat(cleanupTarget, { bigint: true });
      if (!currentDirectory.isDirectory() || currentDirectory.isSymbolicLink() ||
          currentDirectory.dev !== createdDirectory.dev || currentDirectory.ino !== createdDirectory.ino) {
        throw new Error("Partial project directory was replaced; refusing to remove the replacement.");
      }
      await fs.remove(
        cleanupTarget
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

    if (!options.silent) {
      console.log("");
      console.log("Removed partially created project.");
    }

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
