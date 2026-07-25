import chalk from "chalk";

export const logger = {
  info(message: string) {
    console.log(chalk.cyan(message));
  },

  success(message: string) {
    console.log(chalk.green(message));
  },

  warning(message: string) {
    console.log(chalk.yellow(message));
  },

  error(message: string) {
    console.log(chalk.red(message));
  },

  title(message: string) {
    console.log(chalk.blue.bold(message));
  },
};
import { container } from "./serviceContainer.js";

container.register("logger", logger);