import fs from "node:fs/promises";
import path from "node:path";

import {
  FileTransaction,
} from "../../core/fileTransaction.js";

import {
  runCommand,
} from "../../services/processService.js";

import {
  getFeature,
} from "../registry/featureRegistry.js";

import {
  addInstalledFeature,
  isInstalled,
} from "../manifest/featureManifest.js";

import {
  FeatureInstallContext,
} from "./featureInstallContext.js";

import type {
  AuroraFeature,
} from "../feature.js";

export type FeatureCommandRunner =
  typeof runCommand;

export type FeatureResolver =
  (
    featureId: string
  ) => AuroraFeature;

export interface FeatureInstallerOptions {
  commandRunner?:
    FeatureCommandRunner;

  featureResolver?:
    FeatureResolver;
}

export async function installFeature(
  featureId: string,
  projectPath: string,
  options:
    FeatureInstallerOptions = {}
): Promise<void> {
  const projectRoot =
    path.resolve(projectPath);

  await validateProjectDirectory(
    projectRoot
  );

  if (
    await isInstalled(
      projectRoot,
      featureId
    )
  ) {
    console.log("");
    console.log(
      `✅ '${featureId}' is already installed.`
    );

    return;
  }

  const resolveFeature =
    options.featureResolver ??
    getFeature;

  const commandRunner =
    options.commandRunner ??
    runCommand;

  const feature =
    resolveFeature(featureId);

  const dependencies =
    Array.from(
      new Set(
        feature.dependencies
          .map(
            dependency =>
              dependency.trim()
          )
          .filter(Boolean)
      )
    );

  const transaction =
    new FileTransaction(
      "feature installation",
      projectRoot
    );

  const context =
    new FeatureInstallContext(
      projectRoot,
      transaction
    );

  let dependencyInstallationAttempted =
    false;

  console.log("");
  console.log("Installing Feature");
  console.log("==================");
  console.log("");
  console.log(
    `Feature: ${feature.displayName}`
  );
  console.log(
    `Version: ${feature.version}`
  );

  try {
    if (
      dependencies.length > 0
    ) {
      const packageJson =
        context.resolveProjectPath(
          "package.json"
        );

      if (
        !(await fileExists(
          packageJson
        ))
      ) {
        throw new Error(
          `Cannot install feature dependencies because package.json was not found in '${projectRoot}'.`
        );
      }

      const packageFiles = [
        packageJson,
        context.resolveProjectPath(
          "package-lock.json"
        ),
        context.resolveProjectPath(
          "npm-shrinkwrap.json"
        ),
      ];

      for (
        const packageFile of
        packageFiles
      ) {
        await transaction
          .recordModifiedFile(
            packageFile
          );
      }

      console.log("");
      console.log(
        "Installing dependencies..."
      );

      dependencyInstallationAttempted =
        true;

      await commandRunner(
        "npm",
        [
          "install",
          ...dependencies,
        ],
        projectRoot
      );
    }

    console.log("");

    await feature.install(
      context
    );

    await addInstalledFeature(
      projectRoot,
      featureId,
      transaction
    );

    transaction.commit();

    console.log("");
    console.log(
      "✅ Feature installed successfully."
    );
  } catch (error) {
    await transaction.rollback();

    if (
      dependencyInstallationAttempted
    ) {
      try {
        await restoreDependencyState(
          projectRoot,
          commandRunner
        );
      } catch (
        restorationError
      ) {
        throw new AggregateError(
          [
            error,
            restorationError,
          ],
          "Feature installation failed and dependency state could not be fully restored."
        );
      }
    }

    throw error;
  }
}

async function validateProjectDirectory(
  projectRoot: string
): Promise<void> {
  try {
    const information =
      await fs.stat(
        projectRoot
      );

    if (
      !information.isDirectory()
    ) {
      throw new Error(
        `Feature target is not a directory: ${projectRoot}`
      );
    }
  } catch (error) {
    const code =
      (
        error as NodeJS.ErrnoException
      ).code;

    if (code === "ENOENT") {
      throw new Error(
        `Feature target directory does not exist: ${projectRoot}`
      );
    }

    throw error;
  }
}

async function restoreDependencyState(
  projectRoot: string,
  commandRunner:
    FeatureCommandRunner
): Promise<void> {
  const packageJson =
    path.join(
      projectRoot,
      "package.json"
    );

  if (
    !(await fileExists(
      packageJson
    ))
  ) {
    return;
  }

  console.log("");
  console.log(
    "Restoring dependency state..."
  );

  await commandRunner(
    "npm",
    [
      "install",
    ],
    projectRoot
  );
}

async function fileExists(
  file: string
): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
