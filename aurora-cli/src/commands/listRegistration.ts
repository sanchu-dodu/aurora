import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { listTemplatesCommand } from "./list.js";

registerCommand({
  id: "list",
  activation: "catalog",
  register(program: Command): void {
    program
      .command("list")
      .description("List Aurora resources")
      .argument("<resource>")
      .action(async (resource: string) => {
        switch (resource) {
          case "templates":
            await listTemplatesCommand();
            break;

          default:
            console.log(`Unknown resource '${resource}'.`);
        }
      });
  },
});
