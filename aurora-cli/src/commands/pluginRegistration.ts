import {
  Command,
} from "commander";

import {
  registerCommand,
} from "../core/commandRegistry.js";

import {
  pluginListCommand,
} from "./plugin.js";

registerCommand({
  id: "plugin",

  register(
    program: Command
  ): void {
    program
      .command("plugin")
      .description(
        "Manage Aurora plugins"
      )
      .argument("<action>")
      .action(
        async (
          action: string
        ) => {
          switch (action) {
            case "list":
              await pluginListCommand();
              break;

            default:
              throw new Error(
                `Unknown plugin action '${action}'. Supported action: list.`
              );
          }
        }
      );
  },
});