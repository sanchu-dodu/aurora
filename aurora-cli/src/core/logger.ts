import chalk from "chalk";

import {
  redactText,
} from "../security/secretRedactor.js";

export const logger = {
  info(message: string): void {
    console.log(
      chalk.cyan(
        redactText(message)
      )
    );
  },

  success(message: string): void {
    console.log(
      chalk.green(
        redactText(message)
      )
    );
  },

  warning(message: string): void {
    console.log(
      chalk.yellow(
        redactText(message)
      )
    );
  },

  error(message: string): void {
    console.error(
      chalk.red(
        redactText(message)
      )
    );
  },

  title(message: string): void {
    console.log(
      chalk.blue.bold(
        redactText(message)
      )
    );
  },
};
