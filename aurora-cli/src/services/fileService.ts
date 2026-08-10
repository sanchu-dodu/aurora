import fs from "fs-extra";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

export async function directoryExists(
  path: string
): Promise<boolean> {
  return fs.pathExists(path);
}

export async function createDirectory(
  projectPath: string,
  relativePath: string
): Promise<void> {
  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  await fs.ensureDir(
    pathBoundary.resolve(
      relativePath
    )
  );

  pathBoundary.resolve(
    relativePath
  );
}

export async function copyDirectory(
  source: string,
  projectPath: string,
  relativeDestination: string
): Promise<void> {
  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  await fs.copy(
    source,
    pathBoundary.resolve(
      relativeDestination
    ),
    {
      dereference: true,
    }
  );

  pathBoundary.resolve(
    relativeDestination
  );
}
