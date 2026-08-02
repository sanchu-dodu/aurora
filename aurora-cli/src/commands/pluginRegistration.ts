import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { pluginListCommand } from "./plugin.js";


registerCommand({
  register(program: Command): void {


    program
      .command("plugin")
      .description("Manage Aurora plugins")
      .argument("<action>")
      .action(async (action: string) => {
        switch (action) {
          case "list":
            await pluginListCommand();
            break;

          default:
            console.log(`Unknown action '${action}'.`);
        }
      });
  },
});