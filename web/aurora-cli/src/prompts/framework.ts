import { select } from "@inquirer/prompts";

export async function askFramework(): Promise<string> {
  return await select({
    message: "Select a framework",
    choices: [
      {
        name: "Next.js",
        value: "nextjs",
      },
    ],
  });
}