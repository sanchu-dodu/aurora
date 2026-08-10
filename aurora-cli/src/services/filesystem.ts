import fs from "fs-extra";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

export async function createProjectStructure(
  projectPath: string
): Promise<void> {
  const folders = [
    "app",
    "public",
    "src",
    "src/components",
    "src/lib",
    "src/services",
    "src/types",
  ];

  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  for (const folder of folders) {
    await fs.ensureDir(
      pathBoundary.resolve(folder)
    );

    pathBoundary.resolve(folder);
  }
}
