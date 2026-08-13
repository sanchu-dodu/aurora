import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

import {
  featureListCommand,
  featureInstallCommand,
} from "../features/commands/featureCommand.js";

import {
  listInstalledFeatures,
} from "../features/commands/listInstalledCommand.js";

registerCommand({
  id: "feature",
  subcommandActivations: {
    installed: "none",
    list: "catalog",
  },

  register(program: Command): void {

    const feature =
      program
        .command("feature")
        .description(
          "Manage Aurora features"
        );

    feature
      .command("list")
      .description(
        "List available features"
      )
      .action(async () => {

        await featureListCommand();

      });

    feature
      .command("installed")
      .description(
        "List installed features"
      )
      .argument("<project>")
      .action(
        async (
          project: string
        ) => {

          await listInstalledFeatures(
            project
          );

        }
      );

    feature
      .command("install")
      .description(
        "Install a feature"
      )
      .argument("<feature>")
      .argument("<project>")
      .action(
        async (
          featureId: string,
          project: string
        ) => {

          await featureInstallCommand(
            featureId,
            project
          );

        }
      );

  },

});
