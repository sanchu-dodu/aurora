import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

import {
  type ConfigSetOptions,
  configListCommand,
  configGetCommand,
  configSetCommand,
} from "./config.js";


registerCommand({
  id: "config",
  activation: "none",
  register(program: Command): void {

    program
      .command("config")
      .description(
        "Manage Aurora configuration"
      );


    const config =
      program.commands.find(
        cmd => cmd.name() === "config"
      );


    if (!config) return;


    config
      .command("list")
      .description(
        "List configuration"
      )
      .action(async () => {
        await configListCommand();
      });


    config
      .command("get")
      .argument("<key>")
      .action(async (key: string) => {
        await configGetCommand(key);
      });


    config
      .command("set")
      .argument("<key>")
      .argument("<value>")
      .option(
        "--plan <file>",
        "Write an inspectable plan instead of applying"
      )
      .option(
        "--dry-run",
        "Validate the plan without mutation"
      )
      .option(
        "--yes",
        "Explicitly approve the configuration write"
      )
      .option(
        "--json",
        "Print the plan or result as JSON"
      )
      .action(async (
        key: string,
        value: string,
        options:
          ConfigSetOptions
      ) => {
        await configSetCommand(
          key,
          value,
          options
        );
      });
  },
});
