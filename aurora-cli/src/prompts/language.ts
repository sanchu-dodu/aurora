import { select } from "@inquirer/prompts";

export async function askLanguage(): Promise<string> {
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