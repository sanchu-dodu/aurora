export interface AuroraConfig {
  logLevel: "info" | "debug";
  autoInstall: boolean;
  autoGit: boolean;
}

const config: AuroraConfig = {
  logLevel: "info",
  autoInstall: true,
  autoGit: true,
};

export function getConfig(): AuroraConfig {
  return config;
}
import { container } from "./serviceContainer.js";

container.register("config", config);