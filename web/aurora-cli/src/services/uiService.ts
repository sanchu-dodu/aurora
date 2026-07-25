import chalk from "chalk";

export function title(text: string): void {

  console.log("");
  console.log(chalk.cyan.bold(text));
  console.log(chalk.gray("=".repeat(text.length)));

}

export function success(text: string): void {

  console.log(chalk.green(`✔ ${text}`));

}

export function error(text: string): void {

  console.log(chalk.red(`✖ ${text}`));

}

export function warning(text: string): void {

  console.log(chalk.yellow(`⚠ ${text}`));

}

export function info(text: string): void {

  console.log(chalk.blue(text));

}