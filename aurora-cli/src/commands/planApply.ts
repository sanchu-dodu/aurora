import {
  createConfigSetPlan,
} from "../operations/configPlan.js";

import {
  printApplyResult,
  printOperationPlan,
} from "../operations/operationPlanOutput.js";

import {
  OperationPlanService,
} from "../operations/operationPlanService.js";

export interface PlanConfigSetOptions {
  readonly out: string;

  readonly json?: boolean;
}

export interface ApplyPlanOptions {
  readonly yes?: boolean;

  readonly dryRun?: boolean;

  readonly json?: boolean;
}

export async function planConfigSetCommand(
  key: string,
  value: string,
  options: PlanConfigSetOptions
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

  const output =
    await service.writePlanFile(
      plan,
      options.out
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
    console.log(
      `Apply with: aurora apply "${output}" --yes`
    );
  }
}

export async function applyPlanCommand(
  planFile: string,
  options: ApplyPlanOptions
): Promise<void> {
  const service =
    new OperationPlanService();
  const plan =
    await service.readPlanFile(
      planFile
    );

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
