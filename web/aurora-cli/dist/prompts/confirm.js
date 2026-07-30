import { confirm } from "@inquirer/prompts";
export async function askConfirmation(message, defaultValue = true) {
    return confirm({
        message,
        default: defaultValue,
    });
}
//# sourceMappingURL=confirm.js.map