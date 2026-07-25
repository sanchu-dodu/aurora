import fs from "fs-extra";
import path from "path";

export async function discoverFiles(
  directory: string,
  extension = ".js"
): Promise<string[]> {

  const results: string[] = [];

  if (!(await fs.pathExists(directory))) {
    return results;
  }

  const entries = await fs.readdir(directory);

  for (const entry of entries) {

    const fullPath = path.join(directory, entry);

    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {

      const nested = await discoverFiles(
        fullPath,
        extension
      );

      results.push(...nested);

      continue;
    }

    if (entry.endsWith(extension)) {

      results.push(fullPath);

    }

  }

  return results;

}