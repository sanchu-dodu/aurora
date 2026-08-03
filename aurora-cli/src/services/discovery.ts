import fs from "fs-extra";
import path from "node:path";

import {
  getDefaultProjectTemplateRoot,
} from "../templates/projectTemplatePaths.js";

export async function discoverTemplates(
  templateRoot =
    getDefaultProjectTemplateRoot()
): Promise<string[]> {
  if (
    !(await fs.pathExists(
      templateRoot
    ))
  ) {
    throw new Error(
      `Project template root not found: ${templateRoot}`
    );
  }

  const entries =
    await fs.readdir(
      templateRoot,
      {
        withFileTypes: true,
      }
    );

  const templates:
    string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath =
      path.join(
        templateRoot,
        entry.name,
        "template.json"
      );

    if (
      await fs.pathExists(
        manifestPath
      )
    ) {
      templates.push(
        entry.name
      );
    }
  }

  return templates.sort();
}
