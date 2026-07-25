import { getFeature } from "../registry/featureRegistry.js";
import { runCommand } from "../../services/processService.js";

import {
  isInstalled,
  addInstalledFeature,
} from "../manifest/featureManifest.js";

export async function installFeature(
  featureId: string,
  projectPath: string
): Promise<void> {

  if (
    await isInstalled(
      projectPath,
      featureId
    )
  ) {

    console.log("");
    console.log(
      `✅ '${featureId}' is already installed.`
    );

    return;

  }

  const feature =
    getFeature(featureId);

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

  if (
    feature.dependencies.length > 0
  ) {

    console.log("");
    console.log(
      "Installing dependencies..."
    );

    await runCommand(
      "npm",
      [
        "install",
        ...feature.dependencies,
      ],
      projectPath
    );

  }

  console.log("");

  await feature.install(
    projectPath
  );

  await addInstalledFeature(
    projectPath,
    featureId
  );

  console.log("");

  console.log(
    "✅ Feature installed successfully."
  );

}