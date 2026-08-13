import chalk from "chalk";

import {
  redactText,
} from "../security/secretRedactor.js";

export function title(text: string): void {
  const safeText = redactText(text);

  console.log("");
  console.log(chalk.cyan.bold(safeText));
  console.log(
    chalk.gray(
      "=".repeat(safeText.length)
    )
  );
}

export function success(text: string): void {
  console.log(
    chalk.green(
      `✔ ${redactText(text)}`
    )
  );
}

export function error(text: string): void {
  console.log(
    chalk.red(
      `✖ ${redactText(text)}`
    )
  );
}

export function warning(text: string): void {
  console.log(
    chalk.yellow(
      `⚠ ${redactText(text)}`
    )
  );
}

export function info(text: string): void {
  console.log(
    chalk.blue(
      redactText(text)
    )
  );
}
