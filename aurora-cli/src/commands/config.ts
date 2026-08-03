import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";
import {
  loadConfig,
  saveConfig,
} from "../config/configManager.js";


export async function configListCommand(): Promise<void> {
  const config = await loadConfig();

  console.log("");
  console.log("Aurora Configuration");
  console.log("====================");

  console.log(
    JSON.stringify(config, null, 2)
  );
}


export async function configGetCommand(
  key: string
): Promise<void> {

  const config = await loadConfig();

  if (!(key in config)) {
    throw new AuroraError(
      `Unknown configuration key '${key}'.`,
      {
        code:
          ErrorCodes
            .UNKNOWN_CONFIGURATION_KEY,

        suggestion:
          "Run 'aurora config list' to view supported configuration keys.",
      }
    );
  }

  console.log(
    config[key as keyof typeof config]
  );
}


export async function configSetCommand(
  key: string,
  value: string
): Promise<void> {

  const config = await loadConfig();

  if (!(key in config)) {
    throw new AuroraError(
      `Unknown configuration key '${key}'.`,
      {
        code:
          ErrorCodes
            .UNKNOWN_CONFIGURATION_KEY,

        suggestion:
          "Run 'aurora config list' to view supported configuration keys.",
      }
    );
  }


  const current =
    config[key as keyof typeof config];


  let newValue: unknown = value;


  if (typeof current === "boolean") {
    newValue = value === "true";
  }


  (config as any)[key] = newValue;


  await saveConfig(config);

  console.log(
    `✅ Updated ${key} = ${newValue}`
  );
}
