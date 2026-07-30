import { select } from "@inquirer/prompts";
export async function askLanguage() {
    return await select({
        message: "Select a language",
        choices: [
            {
                name: "TypeScript",
                value: "TypeScript",
            },
            {
                name: "JavaScript",
                value: "JavaScript",
            },
        ],
    });
}
//# sourceMappingURL=language.js.map