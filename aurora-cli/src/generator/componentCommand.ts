import { ComponentGenerator } from "./componentGenerator.js";
import { discoverTemplates } from "../templates/registry/templateRegistry.js";
import { OperationPlanService } from "../operations/operationPlanService.js";
import { printApplyResult, printOperationPlan } from "../operations/operationPlanOutput.js";

export interface GenerateComponentOptions {
  readonly plan?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly json?: boolean;
}

export async function generateComponent(
  project: string,
  name: string,
  options: GenerateComponentOptions = {}
): Promise<void> {
  // Load bundled generator data without package or plugin activation.
  await discoverTemplates();
  const service = new OperationPlanService();
  const plan = await new ComponentGenerator().plan(project, name, service);

  if (options.plan) {
    const output = await service.writePlanFile(plan, options.plan);
    printOperationPlan(plan, options.json);
    if (!options.json) console.log(`Saved plan: ${output}`);
    return;
  }

  if (!options.yes && !options.dryRun) {
    printOperationPlan(plan, options.json);
  }
  const result = await service.apply(plan, project, {
    approved: options.yes === true,
    dryRun: options.dryRun === true,
  });
  printApplyResult(result, options.json);
}
