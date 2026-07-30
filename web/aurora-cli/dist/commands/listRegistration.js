import { registerCommand } from "../core/commandRegistry.js";
import { listTemplatesCommand } from "./list.js";
registerCommand({
    register(program) {
        program
            .command("list")
            .description("List Aurora resources")
            .argument("<resource>")
            .action(async (resource) => {
            switch (resource) {
                case "templates":
                    await listTemplatesCommand();
                    break;
                default:
                    console.log(`Unknown resource '${resource}'.`);
            }
        });
    },
});
//# sourceMappingURL=listRegistration.js.map