import fs from "fs-extra";
import path from "path";

import {
  AuroraConfig,
  defaultConfig,
} from "./defaults.js";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

const CONFIG_DIRECTORY = ".aurora";

const CONFIG_FILE = "config.json";


function getConfigPath(): string {
  return new ProjectPathBoundary(
    process.cwd()
  ).resolve(
    path.join(
      CONFIG_DIRECTORY,
      CONFIG_FILE
    )
  );
}


export async function loadConfig(): Promise<AuroraConfig> {
  const configPath = getConfigPath();

  if (!(await fs.pathExists(configPath))) {
    return defaultConfig;
  }

  const saved =
    await fs.readJson(configPath);

  return {
    ...defaultConfig,
    ...saved,
  };
}


export async function saveConfig(
  config: AuroraConfig
): Promise<void> {

  const directory =
    new ProjectPathBoundary(
      process.cwd()
    ).resolve(
      CONFIG_DIRECTORY
    );

  await fs.ensureDir(directory);

  await fs.writeJson(
    getConfigPath(),
    config,
    {
      spaces: 2,
    }
  );
}
