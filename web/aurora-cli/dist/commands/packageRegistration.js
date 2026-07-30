import { registerCommand } from "../core/commandRegistry.js";
import { packageListCommand, packageTestManifestCommand, packageResolveCommand, packageInstallCommand, packageUpdateCommand, packageSearchCommand, packageInfoCommand, packageUninstallCommand, packageVerifyCommand, packageRepairCommand, packageTreeCommand, packagePublishCommand, } from "../packages/packageCommand.js";
registerCommand({
    register(program) {
        const pkg = program
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
            .action(async (packageId) => {
            await packageResolveCommand(packageId);
        });
        pkg
            .command("install")
            .description("Install a package")
            .argument("<package>")
            .action(async (packageId) => {
            await packageInstallCommand(packageId);
        });
        pkg
            .command("update")
            .description("Update a package")
            .argument("<package>")
            .action(async (packageId) => {
            await packageUpdateCommand(packageId);
        });
        pkg
            .command("search")
            .description("Search available packages")
            .argument("<query>")
            .action(async (query) => {
            await packageSearchCommand(query);
        });
        pkg
            .command("info")
            .description("Display package information")
            .argument("<package>")
            .action(async (packageId) => {
            await packageInfoCommand(packageId);
        });
        pkg
            .command("uninstall")
            .description("Uninstall a package")
            .argument("<package>")
            .action(async (packageId) => {
            await packageUninstallCommand(packageId);
        });
        pkg
            .command("verify")
            .description("Verify package integrity")
            .argument("<package>")
            .action(async (packageId) => {
            await packageVerifyCommand(packageId);
        });
        pkg
            .command("repair")
            .description("Repair a package")
            .argument("<package>")
            .action(async (packageId) => {
            await packageRepairCommand(packageId);
        });
        pkg
            .command("tree")
            .description("Display dependency tree")
            .argument("<package>")
            .action(async (packageId) => {
            await packageTreeCommand(packageId);
        });
        pkg
            .command("publish")
            .description("Publish a package")
            .argument("<package>")
            .action(async (packageId) => {
            await packagePublishCommand(packageId);
        });
    },
});
//# sourceMappingURL=packageRegistration.js.map