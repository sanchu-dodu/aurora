import { confirm } from "@inquirer/prompts";

export async function askConfirmation(
  message: string,
  defaultValue = true
): Promise<boolean> {
  return confirm({
    message,
    default: defaultValue,
  });
}