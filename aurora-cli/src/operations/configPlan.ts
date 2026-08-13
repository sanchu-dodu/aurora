import {
  loadConfig,
  parseConfig,
} from "../config/configManager.js";

import {
  AURORA_CONFIG_KEYS,
  type AuroraConfig,
  type AuroraConfigKey,
} from "../config/defaults.js";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  redactText,
} from "../security/secretRedactor.js";

import {
  OperationPlanService,
} from "./operationPlanService.js";

import type {
  OperationPlan,
} from "./operationPlan.js";

const CONFIG_KEYS =
  new Set<string>(
    AURORA_CONFIG_KEYS
  );

export async function createConfigSetPlan(
  key: string,
  value: string,
  projectRoot = process.cwd(),
  service =
    new OperationPlanService()
): Promise<OperationPlan> {
  const config =
    await loadConfig(projectRoot);
  const configKey =
    requireConfigKey(key);

  const candidate: AuroraConfig = {
    ...config,
    [configKey]: parseConfigValue(
      configKey,
      value
    ),
  };

  const validated = parseConfig(
    candidate,
    `configuration value for '${configKey}'`
  );

  return service.createFileWritePlan({
    projectRoot,
    relativePath:
      ".aurora/config.json",
    content:
      `${JSON.stringify(
        validated,
        null,
        2
      )}\n`,
    intent: "config.set",
    summary:
      `Set Aurora configuration key '${configKey}'.`,
    description:
      `Write validated configuration for '${configKey}'.`,
    mode: 0o600,
    directoryMode: 0o700,
  });
}

export function requireConfigKey(
  key: string
): AuroraConfigKey {
  if (!CONFIG_KEYS.has(key)) {
    throw new AuroraError(
      `Unknown configuration key '${redactText(key)}'.`,
      {
        code:
          ErrorCodes
            .UNKNOWN_CONFIGURATION_KEY,
        suggestion:
          "Run 'aurora config list' to view supported configuration keys.",
      }
    );
  }

  return key as AuroraConfigKey;
}

export function parseConfigValue(
  key: AuroraConfigKey,
  value: string
): AuroraConfig[AuroraConfigKey] {
  if (
    key === "installDependencies" ||
    key === "initializeGit"
  ) {
    if (
      value !== "true" &&
      value !== "false"
    ) {
      throw new AuroraError(
        `Configuration key '${key}' requires 'true' or 'false'.`,
        {
          code:
            ErrorCodes
              .INVALID_CONFIGURATION,
          suggestion:
            "Use an exact lowercase boolean value.",
        }
      );
    }

    return value === "true";
  }

  return value;
}
