import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

import {
  runCommand,
} from "./processService.js";

import {
  getPackageManager,
} from "./packageManagerService.js";

export type DependencyCommandRunner =
  typeof runCommand;

export async function installDependencies(
  projectPath: string,
  packageManager: string,
  commandRunner:
    DependencyCommandRunner =
      runCommand
): Promise<void> {
  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  const manager =
    getPackageManager(
      packageManager
    );

  await commandRunner(
    manager.executable,
    manager.installCommand,
    pathBoundary.projectRoot
  );
}
