import fs from "fs-extra";
import path from "node:path";

import {
  AuroraConfigSchema,
  defaultConfig,
  type AuroraConfig,
} from "./defaults.js";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

import {
  isSensitiveKey,
} from "../security/secretRedactor.js";

const CONFIG_DIRECTORY =
  ".aurora";

const CONFIG_FILE =
  "config.json";

function getConfigPath(
  projectRoot: string
): string {
  return new ProjectPathBoundary(
    projectRoot
  ).resolve(
    path.join(
      CONFIG_DIRECTORY,
      CONFIG_FILE
    )
  );
}

export async function loadConfig(
  projectRoot = process.cwd()
): Promise<AuroraConfig> {
  const configPath =
    getConfigPath(projectRoot);

  if (
    !(await fs.pathExists(
      configPath
    ))
  ) {
    return {
      ...defaultConfig,
    };
  }

  let saved: unknown;

  try {
    saved = await fs.readJson(
      configPath
    );
  } catch (error) {
    throw new AuroraError(
      "Aurora could not read .aurora/config.json as JSON.",
      {
        code:
          ErrorCodes
            .INVALID_CONFIGURATION,
        suggestion:
          "Repair the configuration file without adding credentials or secret values.",
        cause: error,
      }
    );
  }

  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved)
  ) {
    throw configurationError(
      "Aurora configuration must be a JSON object."
    );
  }

  const secretKeys =
    Object.keys(saved)
      .filter(isSensitiveKey);

  if (secretKeys.length > 0) {
    throw new AuroraError(
      `Secrets are not allowed in .aurora/config.json. Remove: ${secretKeys.join(", ")}.`,
      {
        code:
          ErrorCodes
            .SECRET_IN_CONFIGURATION,
        suggestion:
          "Store credentials in the operating system credential store instead.",
      }
    );
  }

  return parseConfig(
    {
      ...defaultConfig,
      ...saved,
    },
    configPath
  );
}

export async function saveConfig(
  config: AuroraConfig,
  projectRoot = process.cwd()
): Promise<void> {
  const validated =
    parseConfig(
      config,
      ".aurora/config.json"
    );

  const boundary =
    new ProjectPathBoundary(
      projectRoot
    );

  const directory =
    boundary.resolve(
      CONFIG_DIRECTORY
    );

  await fs.ensureDir(
    directory,
    {
      mode: 0o700,
    }
  );

  await fs.writeJson(
    getConfigPath(projectRoot),
    validated,
    {
      spaces: 2,
      mode: 0o600,
    }
  );

  await fs.chmod(
    directory,
    0o700
  );

  await fs.chmod(
    getConfigPath(projectRoot),
    0o600
  );
}

export function parseConfig(
  value: unknown,
  source = "Aurora configuration"
): AuroraConfig {
  const result =
    AuroraConfigSchema.safeParse(
      value
    );

  if (result.success) {
    return result.data;
  }

  const details =
    result.error.issues.map(
      issue => {
        const location =
          issue.path.length > 0
            ? issue.path.join(".")
            : "configuration";

        return `${location}: ${issue.message}`;
      }
    ).join("; ");

  throw configurationError(
    `Invalid ${source}: ${details}`
  );
}

function configurationError(
  message: string
): AuroraError {
  return new AuroraError(
    message,
    {
      code:
        ErrorCodes
          .INVALID_CONFIGURATION,
      suggestion:
        "Use only supported non-secret Aurora configuration keys and values.",
    }
  );
}
