import chalk from "chalk";
export function title(text) {
    console.log("");
    console.log(chalk.cyan.bold(text));
    console.log(chalk.gray("=".repeat(text.length)));
}
export function success(text) {
    console.log(chalk.green(`✔ ${text}`));
}
export function error(text) {
    console.log(chalk.red(`✖ ${text}`));
}
export function warning(text) {
    console.log(chalk.yellow(`⚠ ${text}`));
}
export function info(text) {
    console.log(chalk.blue(text));
}
//# sourceMappingURL=uiService.js.map