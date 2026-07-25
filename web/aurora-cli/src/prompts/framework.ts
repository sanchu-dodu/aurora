import { select } from "@inquirer/prompts";
import { getAvailableFrameworks } from "../services/frameworks.js";

export async function askFramework(): Promise<string> {
  const frameworks = await getAvailableFrameworks();

  return await select({
    message: "Select a framework",
    choices: frameworks,
  });
}