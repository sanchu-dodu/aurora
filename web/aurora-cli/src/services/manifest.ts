import fs from "fs-extra";
import path from "path";

import type { TemplateManifest } from "../types/template.js";

export async function loadTemplateManifest(
  templateDirectory: string
): Promise<TemplateManifest> {
  const manifestPath = path.join(
    process.cwd(),
    "templates",
    templateDirectory,
    "template.json"
  );

  const exists = await fs.pathExists(manifestPath);

  if (!exists) {
    throw new Error(
      `Template manifest not found: ${manifestPath}`
    );
  }

  return fs.readJson(manifestPath);
}