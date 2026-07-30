import chalk from "chalk";
export const logger = {
    info(message) {
        console.log(chalk.cyan(message));
    },
    success(message) {
        console.log(chalk.green(message));
    },
    warning(message) {
        console.log(chalk.yellow(message));
    },
    error(message) {
        console.log(chalk.red(message));
    },
    title(message) {
        console.log(chalk.blue.bold(message));
    },
};
import { container } from "./serviceContainer.js";
container.register("logger", logger);
//# sourceMappingURL=logger.js.map