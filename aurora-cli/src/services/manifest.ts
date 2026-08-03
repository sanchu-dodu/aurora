import fs from "fs-extra";
import path from "node:path";

import type {
  TemplateManifest,
} from "../types/template.js";

import {
  getDefaultProjectTemplateRoot,
  resolvePathWithinRoot,
} from "../templates/projectTemplatePaths.js";

export async function loadTemplateManifest(
  templateDirectory: string,
  templateRoot =
    getDefaultProjectTemplateRoot()
): Promise<TemplateManifest> {
  const templatePath =
    resolvePathWithinRoot(
      templateRoot,
      templateDirectory
    );

  const manifestPath =
    path.join(
      templatePath,
      "template.json"
    );

  if (
    !(await fs.pathExists(
      manifestPath
    ))
  ) {
    throw new Error(
      `Template manifest not found: ${manifestPath}`
    );
  }

  return fs.readJson(
    manifestPath
  );
}
