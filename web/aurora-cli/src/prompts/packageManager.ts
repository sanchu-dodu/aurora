import { select } from "@inquirer/prompts";

export async function askPackageManager(): Promise<string> {
  return await select({
    message: "Select a package manager",
    choices: [
      {
        name: "npm",
        value: "npm",
      },
      {
        name: "pnpm",
        value: "pnpm",
      },
      {
        name: "yarn",
        value: "yarn",
      },
      {
        name: "bun",
        value: "bun",
      },
    ],
  });
}