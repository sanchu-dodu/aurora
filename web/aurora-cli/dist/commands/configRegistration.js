import { registerCommand } from "../core/commandRegistry.js";
import { configListCommand, configGetCommand, configSetCommand, } from "./config.js";
registerCommand({
    register(program) {
        program
            .command("config")
            .description("Manage Aurora configuration");
        const config = program.commands.find(cmd => cmd.name() === "config");
        if (!config)
            return;
        config
            .command("list")
            .description("List configuration")
            .action(async () => {
            await configListCommand();
        });
        config
            .command("get")
            .argument("<key>")
            .action(async (key) => {
            await configGetCommand(key);
        });
        config
            .command("set")
            .argument("<key>")
            .argument("<value>")
            .action(async (key, value) => {
            await configSetCommand(key, value);
        });
    },
});
//# sourceMappingURL=configRegistration.js.map