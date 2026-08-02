import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

import {
  templateInfoCommand,
  templateSearchCommand,
  templateInstallCommand,
} from "./template.js";

registerCommand({
  register(program: Command): void {

    const template = program
      .command("template")
      .description("Manage Aurora templates");

    template
      .command("info")
      .argument("<id>")
      .description("Show template information")
      .action(async (id: string) => {
        await templateInfoCommand(id);
      });

    template
      .command("search")
      .argument("<query>")
      .description("Search templates")
      .action(async (query: string) => {
        await templateSearchCommand(query);
      });

    template
      .command("install")
      .argument("<id>")
      .argument("<projectName>")
      .description("Create a project from a template")
      .action(
        async (
          id: string,
          projectName: string
        ) => {
          await templateInstallCommand(
            id,
            projectName
          );
        }
      );
  },
});