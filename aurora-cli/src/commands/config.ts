import {
  loadConfig,
  parseConfig,
  saveConfig,
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
  redactSensitiveValue,
  redactText,
} from "../security/secretRedactor.js";

const CONFIG_KEYS =
  new Set<string>(
    AURORA_CONFIG_KEYS
  );

export async function configListCommand(): Promise<void> {
  const config = await loadConfig();

  console.log("");
  console.log("Aurora Configuration");
  console.log("====================");
  console.log(
    JSON.stringify(
      redactSensitiveValue(config),
      null,
      2
    )
  );
}

export async function configGetCommand(
  key: string
): Promise<void> {
  const config = await loadConfig();
  const configKey =
    requireConfigKey(key);

  console.log(
    redactSensitiveValue(
      config[configKey]
    )
  );
}

export async function configSetCommand(
  key: string,
  value: string
): Promise<void> {
  const config = await loadConfig();
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

  await saveConfig(validated);

  console.log(
    redactText(
      `Updated ${configKey} = ${String(validated[configKey])}`
    )
  );
}

function requireConfigKey(
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

function parseConfigValue(
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
