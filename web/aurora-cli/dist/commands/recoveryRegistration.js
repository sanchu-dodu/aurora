import { registerCommand } from "../core/commandRegistry.js";
import { recoveryListCommand, recoveryRollbackCommand, } from "../packages/recovery/recoveryCommand.js";
registerCommand({
    register(program) {
        const recovery = program
            .command("recovery")
            .description("Manage interrupted transactions");
        recovery
            .command("list")
            .description("List incomplete transactions")
            .action(async () => {
            await recoveryListCommand();
        });
        recovery
            .command("rollback")
            .description("Rollback interrupted update")
            .argument("<package>")
            .action(async (packageId) => {
            await recoveryRollbackCommand(packageId);
        });
    },
});
//# sourceMappingURL=recoveryRegistration.js.map