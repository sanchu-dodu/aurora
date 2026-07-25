import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

import {
  packageListCommand,
  packageTestManifestCommand,
  packageResolveCommand,
  packageInstallCommand,
} from "../packages/packageCommand.js";

registerCommand({

  register(program: Command): void {

    const pkg =
      program
        .command("package")
        .description("Manage Aurora packages");

    pkg
      .command("list")
      .description("List available packages")
      .action(async () => {

        await packageListCommand();

      });

    pkg
      .command("manifest")
      .description("Test manifest loading")
      .action(async () => {

        await packageTestManifestCommand();

      });

    pkg
      .command("resolve")
      .description("Resolve package dependencies")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageResolveCommand(
            packageId
          );

        }
      );

    pkg
      .command("install")
      .description("Install a package")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageInstallCommand(
            packageId
          );

        }
      );

  },

});