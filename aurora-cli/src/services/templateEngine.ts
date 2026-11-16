import fs from "fs-extra";
import path from "node:path";

import type {
  ProjectConfig,
} from "../types/project.js";

import {
  getTemplateDirectory,
} from "../engine/registry.js";

import {
  replaceVariables,
} from "../engine/variables.js";

import {
  shouldGenerateFile,
} from "../engine/filter.js";

import {
  validateTemplate,
} from "../engine/templateValidator.js";

import {
  getDefaultProjectTemplateRoot,
  resolvePathWithinRoot,
} from "../templates/projectTemplatePaths.js";

import {
  loadTemplateManifest,
} from "./manifest.js";

import {
  walkDirectory,
} from "./walker.js";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

export async function copyTemplate(
  projectPath: string,
  config: ProjectConfig,
  templateRoot = getDefaultProjectTemplateRoot()
): Promise<string[]> {
  const pathBoundary = new ProjectPathBoundary(projectPath);
  const files = await selectTemplateFiles(config, templateRoot);
  for (const { source, relativePath } of files) {
    const destination = pathBoundary.resolve(relativePath);
    await fs.ensureDir(path.dirname(destination));
    const content = replaceVariables(await fs.readFile(source, "utf8"), config);
    await fs.writeFile(pathBoundary.resolve(relativePath), content, "utf8");
  }
  return files.map(file => file.relativePath);
}

/** Calculate the same output paths as copyTemplate without copying the files. */
export async function listTemplateOutputPaths(
  config: ProjectConfig,
  templateRoot = getDefaultProjectTemplateRoot()
): Promise<string[]> {
  return (await selectTemplateFiles(config, templateRoot)).map(file => file.relativePath);
}

async function selectTemplateFiles(
  config: ProjectConfig,
  templateRoot: string
): Promise<{ source: string; relativePath: string }[]> {
  const templateDirectory =
    getTemplateDirectory(config);

  const templatePath =
    resolvePathWithinRoot(
      templateRoot,
      templateDirectory
    );

  const manifest =
    await loadTemplateManifest(
      templateDirectory,
      templateRoot
    );

  if (
    manifest.framework
      .toLowerCase() !==
    config.framework
      .toLowerCase()
  ) {
    throw new Error(
      `Template '${manifest.displayName}' does not support framework '${config.framework}'.`
    );
  }

  if (
    !manifest.language.includes(
      config.language.toLowerCase()
    )
  ) {
    throw new Error(
      `Language '${config.language}' is not supported by '${manifest.displayName}'.`
    );
  }

  if (
    !manifest.packageManagers.includes(
      config.packageManager
        .toLowerCase()
    )
  ) {
    throw new Error(
      `Package manager '${config.packageManager}' is not supported by '${manifest.displayName}'.`
    );
  }

  await validateTemplate(
    templatePath
  );

  const files =
    await walkDirectory(
      templatePath
    );

  return files.flatMap(source => {
    const relativePath = path.relative(templatePath, source);
    return shouldGenerateFile(relativePath, config)
      ? [{ source, relativePath: mapTemplateOutputPath(replaceVariables(relativePath, config)) }]
      : [];
  });
}

function mapTemplateOutputPath(
  relativePath: string
): string {
  const segments =
    relativePath
      .replaceAll("\\", "/")
      .split("/")
      .map((segment) =>
        segment ===
        "gitignore.template"
          ? ".gitignore"
          : segment
      );

  return segments.join(
    path.sep
  );
}
