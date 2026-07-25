import fs from "fs-extra";

export async function directoryExists(
  path: string
): Promise<boolean> {
  return fs.pathExists(path);
}

export async function createDirectory(
  path: string
): Promise<void> {
  await fs.ensureDir(path);
}

export async function copyDirectory(
  source: string,
  destination: string
): Promise<void> {
  await fs.copy(source, destination);
}