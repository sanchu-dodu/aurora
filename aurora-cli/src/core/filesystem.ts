import fs from "fs-extra";
import path from "path";

export async function readDirectory(
  directory: string
): Promise<string[]> {
  const entries = await fs.readdir(directory);

  return entries.map((entry) =>
    path.join(directory, entry)
  );
}

export async function exists(
  target: string
): Promise<boolean> {
  return fs.pathExists(target);
}