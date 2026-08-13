import {
  Command,
} from "commander";

import {
  registerCommand,
} from "../core/commandRegistry.js";

import {
  applyPlanCommand,
  planConfigSetCommand,
  type ApplyPlanOptions,
  type PlanConfigSetOptions,
} from "./planApply.js";

registerCommand({
  id: "plan",
  activation: "none",
  register(program: Command): void {
    const plan = program
      .command("plan")
      .description(
        "Create an inspectable Aurora operation plan"
      );

    const config = plan
      .command("config")
      .description(
        "Plan configuration changes"
      );

    config
      .command("set")
      .argument("<key>")
      .argument("<value>")
      .requiredOption(
        "--out <file>",
        "Write the plan to a new JSON file"
      )
      .option(
        "--json",
        "Print the plan as JSON"
      )
      .action(
        async (
          key: string,
          value: string,
          options:
            PlanConfigSetOptions
        ) => {
          await planConfigSetCommand(
            key,
            value,
            options
          );
        }
      );
  },
});

registerCommand({
  id: "apply",
  activation: "none",
  register(program: Command): void {
    program
      .command("apply")
      .description(
        "Validate and apply an exported Aurora operation plan"
      )
      .argument("<planFile>")
      .option(
        "--yes",
        "Explicitly approve plan mutations"
      )
      .option(
        "--dry-run",
        "Validate without mutation"
      )
      .option(
        "--json",
        "Print the result as JSON"
      )
      .action(
        async (
          planFile: string,
          options:
            ApplyPlanOptions
        ) => {
          await applyPlanCommand(
            planFile,
            options
          );
        }
      );
  },
});
