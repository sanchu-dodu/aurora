import fs from "fs-extra";
import path from "node:path";

import type {
  TemplateMetadata,
} from "../templateMetadata.js";

import {
  getDefaultGeneratorTemplateRoot,
} from "../templatePaths.js";

const templates =
  new Map<string, TemplateMetadata>();

export async function discoverTemplates(
  templateRoot =
    getDefaultGeneratorTemplateRoot()
): Promise<void> {
  templates.clear();

  if (
    !(await fs.pathExists(templateRoot))
  ) {
    throw new Error(
      `Generator template root not found: ${templateRoot}`
    );
  }

  await scan(templateRoot);
}

async function scan(
  directory: string
): Promise<void> {
  const entries = await fs.readdir(
    directory,
    {
      withFileTypes: true,
    }
  );

  for (const entry of entries) {
    const fullPath = path.join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      await scan(fullPath);
      continue;
    }

    if (
      !entry.name.endsWith(".json")
    ) {
      continue;
    }

    const metadata =
      await fs.readJson(
        fullPath
      ) as TemplateMetadata;

    const templateId =
      metadata.id?.trim();

    if (!templateId) {
      throw new Error(
        `Generator metadata at '${fullPath}' has no identifier.`
      );
    }

    if (templates.has(templateId)) {
      throw new Error(
        `Generator template '${templateId}' is already registered.`
      );
    }

    templates.set(
      templateId,
      metadata
    );
  }
}

export function getTemplate(
  id: string
): TemplateMetadata {
  const template =
    templates.get(id);

  if (!template) {
    throw new Error(
      `Unknown template: ${id}`
    );
  }

  return template;
}

export function listTemplates():
  TemplateMetadata[] {
  return [
    ...templates.values(),
  ].sort(
    (left, right) =>
      left.id.localeCompare(right.id)
  );
}
