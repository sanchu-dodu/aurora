import {
  loadConfig,
} from "../config/configManager.js";

import {
  createConfigSetPlan,
  requireConfigKey,
} from "../operations/configPlan.js";

import {
  printApplyResult,
  printOperationPlan,
} from "../operations/operationPlanOutput.js";

import {
  OperationPlanService,
} from "../operations/operationPlanService.js";

import {
  redactSensitiveValue,
} from "../security/secretRedactor.js";

export interface ConfigSetOptions {
  readonly dryRun?: boolean;

  readonly json?: boolean;

  readonly plan?: string;

  readonly yes?: boolean;
}

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
  value: string,
  options: ConfigSetOptions = {}
): Promise<void> {
  const service =
    new OperationPlanService();
  const plan =
    await createConfigSetPlan(
      key,
      value,
      process.cwd(),
      service
    );

  if (options.plan) {
    const output =
      await service.writePlanFile(
        plan,
        options.plan
      );

    printOperationPlan(
      plan,
      options.json
    );

    if (!options.json) {
      console.log("");
      console.log(
        `Saved plan: ${output}`
      );
    }

    return;
  }

  if (
    !options.yes &&
    !options.dryRun
  ) {
    printOperationPlan(
      plan,
      options.json
    );
  }

  const result =
    await service.apply(
      plan,
      process.cwd(),
      {
        approved:
          options.yes === true,
        dryRun:
          options.dryRun === true,
      }
    );

  printApplyResult(
    result,
    options.json
  );
}
