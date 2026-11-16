import { Command, Option } from "commander";
import type { GenerateComponentOptions } from "../generator/componentCommand.js";

import { registerCommand } from "../core/commandRegistry.js";

registerCommand({
  id: "generate",
  subcommandActivations: {
    list: "catalog",
    component: "none",
  },

  register(program: Command): void {

    const generate = program
      .command("generate")
      .description("Generate project files");

    generate
      .command("component")
      .description("Generate a React component")
      .argument("<project>")
      .argument("<name>")
      .addOption(new Option("--plan <file>", "Export a new plan file for review")
        .conflicts(["dryRun", "yes"]))
      .option("--dry-run", "Validate component creation without writing files")
      .option("--yes", "Approve creation of a new component")
      .option("--json", "Print the plan or operation report as JSON")
      .action(
        async (
          project: string,
          name: string,
          options: GenerateComponentOptions
        ) => {

          const {
            generateComponent,
          } = await import(
            "../generator/componentCommand.js"
          );

          await generateComponent(
            project,
            name,
            options
          );

        }
      );

    generate
      .command("list")
      .description(
        "List available generators"
      )
      .action(
        async () => {

          const {
            listGeneratorCommand,
          } = await import(
            "../generator/listGenerators.js"
          );

          await listGeneratorCommand();

        }
      );

  },

});
