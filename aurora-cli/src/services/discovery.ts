import fs from "fs-extra";
import path from "path";

export async function discoverTemplates(): Promise<string[]> {
  const templatesRoot = path.join(
    process.cwd(),
    "templates"
  );

  const entries = await fs.readdir(templatesRoot);

  const templates: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(templatesRoot, entry);

    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      templates.push(entry);
    }
  }

  return templates.sort();
}