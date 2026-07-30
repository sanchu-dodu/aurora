import { registerCommand } from "../core/commandRegistry.js";
import { featureListCommand, featureInstallCommand, } from "../features/commands/featureCommand.js";
import { listInstalledFeatures, } from "../features/commands/listInstalledCommand.js";
registerCommand({
    register(program) {
        const feature = program
            .command("feature")
            .description("Manage Aurora features");
        feature
            .command("list")
            .description("List available features")
            .action(async () => {
            await featureListCommand();
        });
        feature
            .command("installed")
            .description("List installed features")
            .argument("<project>")
            .action(async (project) => {
            await listInstalledFeatures(project);
        });
        feature
            .command("install")
            .description("Install a feature")
            .argument("<feature>")
            .argument("<project>")
            .action(async (featureId, project) => {
            await featureInstallCommand(featureId, project);
        });
    },
});
//# sourceMappingURL=featureRegistration.js.map