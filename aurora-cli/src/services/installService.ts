import path from "node:path";

import type {
  ProjectConfig,
} from "../types/project.js";

import {
  createProject,
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
  const template =
    await getTemplateById(
      templateId
    );

  if (!template) {
    console.log(
      `Template '${templateId}' not found.`
    );

    return false;
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

  console.log("");
  console.log(
    `Installing ${template.displayName}`
  );

  await createProject(
    config,
    options.projectCreation
  );

  return true;
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
