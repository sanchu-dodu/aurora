import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { initCommand } from "./init.js";

registerCommand({
  register(program: Command) {
    program
      .command("init")
      .description("Initialize a new Aurora project")
      .action(async () => {
        await initCommand();
      });
  },
});