import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { initCommand, type InitOptions } from "./init.js";

registerCommand({
  id: "init",
  activation: "none",
  register(program: Command) {
    program
      .command("init")
      .description("Initialize a new Aurora project")
      .option("--dry-run", "Preview the wizard choices and starter files without writing")
      .action(async (options: InitOptions) => {
        await initCommand(options);
      });
  },
});
