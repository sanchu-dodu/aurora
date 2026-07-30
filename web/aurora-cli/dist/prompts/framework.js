import { select } from "@inquirer/prompts";
import { getAvailableFrameworks } from "../services/frameworks.js";
export async function askFramework() {
    const frameworks = await getAvailableFrameworks();
    return await select({
        message: "Select a framework",
        choices: frameworks,
    });
}
//# sourceMappingURL=framework.js.map