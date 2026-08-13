import {
  Command,
} from "commander";

import {
  registerCommand,
} from "../core/commandRegistry.js";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  pluginListCommand,
} from "./plugin.js";

registerCommand({
  id: "plugin",
  activation: "catalog",

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
              throw new AuroraError(
                `Unknown plugin action '${action}'.`,
                {
                  code:
                    ErrorCodes
                      .UNKNOWN_PLUGIN_ACTION,

                  suggestion:
                    "Supported plugin action: list.",
                }
              );
          }
        }
      );
  },
});