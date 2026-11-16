import path from "node:path";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import type {
  ProjectConfig,
} from "../types/project.js";

import {
  createProject,
  previewProjectCreation,
  type ProjectCreationOptions,
} from "./project.js";

import {
  getTemplateById,
} from "./templateService.js";

import {
  loadTemplateManifest,
} from "./manifest.js";

export interface InstallProjectOptions {
  language?: string;

  packageManager?: string;

  installDependencies?: boolean;

  initializeGit?: boolean;

  projectCreation?:
    ProjectCreationOptions;
}

export async function installProject(
  templateId: string,
  projectName: string,
  options:
    InstallProjectOptions = {}
): Promise<boolean> {
  await createTemplateProject(templateId, projectName, options);
  return true;
}

export async function createTemplateProject(
  templateId: string, projectName: string, options: InstallProjectOptions = {}
) {
  const { config, template, report } = await prepareTemplateInstallation(templateId, projectName, options);
  if (!options.projectCreation?.silent) {
    console.log("");
    console.log(`Installing ${template.displayName}`);
  }
  const root = await createProject(config, options.projectCreation);
  return { ...report, status: "created", root } as const;
}

/** An informational preview of the default offline installation. */
export async function previewTemplateInstallation(
  templateId: string, projectName: string,
  projectCreation: Pick<ProjectCreationOptions, "workspaceRoot" | "templateRoot"> = {}
) {
  const { config, report } = await prepareTemplateInstallation(templateId, projectName, { projectCreation });
  const { root, files } = await previewProjectCreation(config, projectCreation);
  return { ...report, status: "dry-run", root, files } as const;
}

async function prepareTemplateInstallation(
  templateId: string, projectName: string, options: InstallProjectOptions
) {
  const template =
    await getTemplateById(
      templateId
    );

  if (!template) {
    throw new AuroraError(
      `Template '${templateId}' not found.`,
      {
        code:
          ErrorCodes
            .TEMPLATE_NOT_FOUND,

        suggestion:
          "Run 'aurora template search <query>' to discover available templates.",
      }
    );
  }

  const templateDirectory =
    path.basename(
      path.normalize(
        template.path
      )
    );

  if (
    !templateDirectory ||
    templateDirectory === "."
  ) {
    throw new Error(
      `Template '${templateId}' has an invalid template path.`
    );
  }

  const manifest =
    await loadTemplateManifest(
      templateDirectory,
      options.projectCreation
        ?.templateRoot
    );

  const language =
    options.language ??
    selectSupportedValue(
      manifest.language,
      "typescript",
      "language",
      templateId
    );

  const packageManager =
    options.packageManager ??
    selectSupportedValue(
      manifest.packageManagers,
      "npm",
      "package manager",
      templateId
    );

  validateSupportedValue(
    manifest.language,
    language,
    "language",
    templateId
  );

  validateSupportedValue(
    manifest.packageManagers,
    packageManager,
    "package manager",
    templateId
  );

  const config:
    ProjectConfig = {
    projectName,
    framework:
      template.framework,
    language,
    packageManager,

    // Template installation is deterministic
    // by default. Network and Git operations
    // must be explicitly requested.
    installDependencies:
      options.installDependencies ??
      false,

    initializeGit:
      options.initializeGit ??
      false,
  };

  return { config, template, report: {
    schemaVersion: 1 as const,
    template: { id: template.id, version: manifest.version },
    framework: config.framework,
    language: config.language,
    packageManager: config.packageManager,
    installDependencies: config.installDependencies,
    initializeGit: config.initializeGit,
  } };
}

function selectSupportedValue(
  values: string[],
  preferredValue: string,
  valueType: string,
  templateId: string
): string {
  const normalizedValues =
    values
      .map(
        value =>
          value
            .trim()
            .toLowerCase()
      )
      .filter(Boolean);

  if (
    normalizedValues.length === 0
  ) {
    throw new Error(
      `Template '${templateId}' does not declare a supported ${valueType}.`
    );
  }

  if (
    normalizedValues.includes(
      preferredValue
    )
  ) {
    return preferredValue;
  }

  return normalizedValues[0];
}

function validateSupportedValue(
  supportedValues: string[],
  selectedValue: string,
  valueType: string,
  templateId: string
): void {
  const normalizedValue =
    selectedValue
      .trim()
      .toLowerCase();

  const supported =
    supportedValues.some(
      value =>
        value
          .trim()
          .toLowerCase() ===
        normalizedValue
    );

  if (!supported) {
    throw new Error(
      `Template '${templateId}' does not support ${valueType} '${selectedValue}'.`
    );
  }
}
