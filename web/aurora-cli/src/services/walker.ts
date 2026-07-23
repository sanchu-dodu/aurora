import fs from "fs-extra";
import path from "path";

export async function walkDirectory(
  directory: string
): Promise<string[]> {
  const entries = await fs.readdir(directory);

  let files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      const nested = await walkDirectory(fullPath);
      files.push(...nested);
    } else {
      files.push(fullPath);
    }
  }

  return files;
}