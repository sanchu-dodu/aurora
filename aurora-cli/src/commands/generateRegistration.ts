import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

registerCommand({
  id: "generate",
  subcommandActivations: {
    list: "catalog",
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
      .action(
        async (
          project: string,
          name: string
        ) => {

          const {
            generateComponent,
          } = await import(
            "../generator/componentCommand.js"
          );

          await generateComponent(
            project,
            name
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
