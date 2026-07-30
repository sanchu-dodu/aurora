import { registerCommand } from "../core/commandRegistry.js";
import { templateInfoCommand, templateSearchCommand, templateInstallCommand, } from "./template.js";
registerCommand({
    register(program) {
        const template = program
            .command("template")
            .description("Manage Aurora templates");
        template
            .command("info")
            .argument("<id>")
            .description("Show template information")
            .action(async (id) => {
            await templateInfoCommand(id);
        });
        template
            .command("search")
            .argument("<query>")
            .description("Search templates")
            .action(async (query) => {
            await templateSearchCommand(query);
        });
        template
            .command("install")
            .argument("<id>")
            .argument("<projectName>")
            .description("Create a project from a template")
            .action(async (id, projectName) => {
            await templateInstallCommand(id, projectName);
        });
    },
});
//# sourceMappingURL=templateRegistration.js.map