import { select } from "@inquirer/prompts";

export async function askFramework(): Promise<string> {
  return await select({
    message: "Select a framework",
    choices: [
      {
        name: "Next.js",
        value: "Next.js",
      },
      {
        name: "React",
        value: "React",
      },
      {
        name: "Vue",
        value: "Vue",
      },
      {
        name: "Svelte",
        value: "Svelte",
      },
    ],
  });
}