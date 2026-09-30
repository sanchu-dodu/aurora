import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";

import {
  packageListCommand,
  packageTestManifestCommand,
  packageResolveCommand,
  packageInstallCommand,
  packageInstallOfficialCommand,
  packageUpdateCommand,
  packageSearchCommand,
  packageInfoCommand,
  packageUninstallCommand,
  packageVerifyCommand,
  packageRepairCommand,
  packageTreeCommand,
  packagePublishCommand,
  packageProposeReleaseCommand,
  packageFinalizeReleaseCommand,
  packageActivateReleaseCommand,
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
      .description(
        "Resolve a package from the active verified official registry"
      )
      .argument("<package>")
      .option(
        "--version <version>",
        "Resolve one exact semantic version"
      )
      .option(
        "--range <range>",
        "Resolve the greatest active version satisfying a semantic-version range"
      )
      .option(
        "--registry-digest <digest>",
        "Require the exact registry SHA-256 digest obtained from a trusted source"
      )
      .action(
        async (
          packageId: string,
          options: {
            readonly version?:
              string;
            readonly range?:
              string;
            readonly registryDigest?:
              string;
          }
        ) => {

          await packageResolveCommand(
            packageId,
            options
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
      .command("install-official")
      .description("Install a locked, authenticated package set from the active official registry")
      .argument("<package>")
      .requiredOption("--registry-digest <digest>", "Trusted exact registry SHA-256 digest")
      .option("--version <version>", "Select an exact version for a new lock")
      .option("--range <range>", "Select a compatible version for a new lock")
      .option("--offline", "Use only the existing authenticated lock and verified artifact cache")
      .action(async (packageId: string, options: {
        readonly registryDigest: string;
        readonly version?: string;
        readonly range?: string;
        readonly offline?: boolean;
      }) => {
        await packageInstallOfficialCommand(packageId, options);
      });

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

    pkg
      .command("activate-release")
      .description(
        "Authenticate and explicitly activate a finalized official registry release"
      )
      .argument(
        "<release>",
        "Immutable finalized registry release directory"
      )
      .requiredOption(
        "--registry-history <file>",
        "Signed predecessor snapshots ordered from genesis to current"
      )
      .option(
        "--dry-run",
        "Verify the activation without changing the live registry pointer"
      )
      .action(
        async (
          releasePath: string,
          options: {
            readonly registryHistory:
              string;
            readonly dryRun?:
              boolean;
          }
        ) => {

          await packageActivateReleaseCommand(
            releasePath,
            {
              registryHistory:
                options.registryHistory,
              dryRun:
                options.dryRun ===
                  true,
            }
          );

        }
      );

    pkg
      .command("finalize-release")
      .description(
        "Verify an offline signature and finalize an immutable official registry release"
      )
      .argument(
        "<proposal>",
        "Content-addressed registry proposal directory"
      )
      .requiredOption(
        "--registry-history <file>",
        "Signed registry snapshots ordered from genesis to current"
      )
      .requiredOption(
        "--signature <file>",
        "Canonical offline Ed25519 signature file"
      )
      .option(
        "--dry-run",
        "Verify the signed successor without writing files"
      )
      .action(
        async (
          proposalPath: string,
          options: {
            readonly registryHistory:
              string;
            readonly signature:
              string;
            readonly dryRun?:
              boolean;
          }
        ) => {

          await packageFinalizeReleaseCommand(
            proposalPath,
            {
              registryHistory:
                options.registryHistory,
              signature:
                options.signature,
              dryRun:
                options.dryRun ===
                  true,
            }
          );

        }
      );

    pkg
      .command("propose-release")
      .description(
        "Build an offline-signable official registry release proposal"
      )
      .argument("<package>")
      .requiredOption(
        "--registry-history <file>",
        "Signed registry snapshots ordered from genesis to current"
      )
      .requiredOption(
        "--archive-url <url>",
        "Immutable content-addressed HTTPS package archive URL"
      )
      .requiredOption(
        "--published-at <timestamp>",
        "Canonical UTC publication timestamp"
      )
      .option(
        "--dry-run",
        "Verify and preview the proposal without writing files"
      )
      .action(
        async (
          packageId: string,
          options: {
            readonly registryHistory:
              string;
            readonly archiveUrl:
              string;
            readonly publishedAt:
              string;
            readonly dryRun?:
              boolean;
          }
        ) => {

          await packageProposeReleaseCommand(
            packageId,
            {
              registryHistory:
                options.registryHistory,
              archiveUrl:
                options.archiveUrl,
              publishedAt:
                options.publishedAt,
              dryRun:
                options.dryRun ===
                  true,
            }
          );

        }
      );

  },

});

