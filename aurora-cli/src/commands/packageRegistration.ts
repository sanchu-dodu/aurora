import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

import {
  packageListCommand,
  packageTestManifestCommand,
  packageResolveCommand,
  packageInstallCommand,
  packageUpdateCommand,
  packageSearchCommand,
  packageInfoCommand,
  packageUninstallCommand,
  packageVerifyCommand,
  packageRepairCommand,
  packageTreeCommand,
  packagePublishCommand,
} from "../packages/packageCommand.js";

registerCommand({
  id: "package",
  subcommandActivations: {
    info: "catalog",
    list: "catalog",
    manifest: "catalog",
    resolve: "catalog",
    search: "catalog",
    tree: "catalog",
    verify: "catalog",
  },

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

    pkg
      .command("update")
      .description("Update a package")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageUpdateCommand(
            packageId
          );

        }
      );

    pkg
      .command("search")
      .description("Search available packages")
      .argument("<query>")
      .action(
        async (query: string) => {

          await packageSearchCommand(
            query
          );

        }
      );

    pkg
      .command("info")
      .description("Display package information")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageInfoCommand(
            packageId
          );

        }
      );

    pkg
      .command("uninstall")
      .description("Uninstall a package")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageUninstallCommand(
            packageId
          );

        }
      );

    pkg
      .command("verify")
      .description("Verify package integrity")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageVerifyCommand(
            packageId
          );

        }
      );

    pkg
      .command("repair")
      .description("Repair a package")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageRepairCommand(
            packageId
          );

        }
      );

    pkg
      .command("tree")
      .description("Display dependency tree")
      .argument("<package>")
      .action(
        async (packageId: string) => {

          await packageTreeCommand(
            packageId
          );

        }
      );

    pkg
      .command("publish")
      .description(
        "Build a verified local package publication bundle"
      )
      .argument("<package>")
      .option(
        "--dry-run",
        "Verify and preview the bundle without writing files"
      )
      .action(
        async (
          packageId: string,
          options: {
            readonly dryRun?:
              boolean;
          }
        ) => {

          await packagePublishCommand(
            packageId,
            {
              dryRun:
                options.dryRun ===
                  true,
            }
          );

        }
      );

  },

});

