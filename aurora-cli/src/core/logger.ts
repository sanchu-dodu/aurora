import chalk from "chalk";

export const logger = {
  info(message: string): void {
    console.log(
      chalk.cyan(message)
    );
  },

  success(message: string): void {
    console.log(
      chalk.green(message)
    );
  },

  warning(message: string): void {
    console.log(
      chalk.yellow(message)
    );
  },

  error(message: string): void {
    console.error(
      chalk.red(message)
    );
  },

  title(message: string): void {
    console.log(
      chalk.blue.bold(message)
    );
  },
};
