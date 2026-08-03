import path from "node:path";

import { Generator } from "./generator.js";
import { TemplateRenderer } from "./templateRenderer.js";

import {
  getTemplate,
} from "../templates/registry/templateRegistry.js";

import {
  getDefaultGeneratorTemplateRoot,
} from "../templates/templatePaths.js";

export class ComponentGenerator {
  constructor(
    private readonly templateRoot =
      getDefaultGeneratorTemplateRoot()
  ) {}

  async generate(
    projectPath: string,
    componentName: string
  ): Promise<void> {
    validateComponentName(
      componentName
    );

    const metadata =
      getTemplate("component");

    const templatePath =
      resolveWithinRoot(
        this.templateRoot,
        metadata.framework,
        metadata.template
      );

    const renderer =
      new TemplateRenderer();

    const content =
      await renderer.render(
        templatePath,
        {
          ComponentName:
            componentName,
        }
      );

    const projectRoot =
      path.resolve(projectPath);

    const outputPath =
      resolveWithinRoot(
        projectRoot,
        metadata.output,
        `${componentName}${metadata.extension}`
      );

    const generator =
      new Generator();

    await generator.generateFile(
      outputPath,
      content
    );
  }
}

function validateComponentName(
  componentName: string
): void {
  const isValidIdentifier =
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(
      componentName
    );

  if (!isValidIdentifier) {
    throw new Error(
      `Invalid component name '${componentName}'. ` +
      "Use a valid JavaScript identifier."
    );
  }
}

function resolveWithinRoot(
  root: string,
  ...segments: string[]
): string {
  const resolvedRoot =
    path.resolve(root);

  const candidate =
    path.resolve(
      resolvedRoot,
      ...segments
    );

  const relative =
    path.relative(
      resolvedRoot,
      candidate
    );

  const escapesRoot =
    relative.startsWith("..") ||
    path.isAbsolute(relative);

  if (escapesRoot) {
    throw new Error(
      `Resolved path escapes its allowed root: ${candidate}`
    );
  }

  return candidate;
}
