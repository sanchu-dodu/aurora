import { registerCommand } from "../core/commandRegistry.js";
import { pluginListCommand } from "./plugin.js";
registerCommand({
    register(program) {
        program
            .command("plugin")
            .description("Manage Aurora plugins")
            .argument("<action>")
            .action(async (action) => {
            switch (action) {
                case "list":
                    await pluginListCommand();
                    break;
                default:
                    console.log(`Unknown action '${action}'.`);
            }
        });
    },
});
//# sourceMappingURL=pluginRegistration.js.map