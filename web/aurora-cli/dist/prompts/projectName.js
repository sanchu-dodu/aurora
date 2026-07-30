import { input } from "@inquirer/prompts";
export async function askProjectName() {
    const name = await input({
        message: "What is your project name?",
        default: "my-aurora-app",
    });
    return name;
}
//# sourceMappingURL=projectName.js.map