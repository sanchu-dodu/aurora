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
  templateRoot =
    getDefaultProjectTemplateRoot()
): Promise<void> {
  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

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

  for (const source of files) {
    const relativePath =
      path.relative(
        templatePath,
        source
      );

    if (
      !shouldGenerateFile(
        relativePath,
        config
      )
    ) {
      continue;
    }

    const processedRelativePath =
      replaceVariables(
        relativePath,
        config
      );

    const outputRelativePath =
      mapTemplateOutputPath(
        processedRelativePath
      );

    const destination =
      pathBoundary.resolve(
        outputRelativePath
      );

    await fs.ensureDir(
      path.dirname(
        destination
      )
    );

    let content =
      await fs.readFile(
        source,
        "utf8"
      );

    content =
      replaceVariables(
        content,
        config
      );

    const validatedDestination =
      pathBoundary.resolve(
        outputRelativePath
      );

    await fs.writeFile(
      validatedDestination,
      content,
      "utf8"
    );
  }
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
