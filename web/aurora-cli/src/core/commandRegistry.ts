import { Command } from "commander";

export interface AuroraCommand {
  register(program: Command): void;
}

const registry: AuroraCommand[] = [];

export function registerCommand(
  command: AuroraCommand
): void {
  registry.push(command);
}

export function registerAllCommands(
  program: Command
): void {
  for (const command of registry) {
    command.register(program);
  }
}