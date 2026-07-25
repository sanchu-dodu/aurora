import fs from "fs-extra";
import path from "path";

import {
  AuroraConfig,
  defaultConfig,
} from "./defaults.js";

const CONFIG_DIRECTORY = ".aurora";

const CONFIG_FILE = "config.json";


function getConfigPath(): string {
  return path.join(
    process.cwd(),
    CONFIG_DIRECTORY,
    CONFIG_FILE
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
    path.join(
      process.cwd(),
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