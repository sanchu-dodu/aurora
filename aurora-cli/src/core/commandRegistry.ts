import type { Command } from "commander";

export type CommandActivation =
  | "none"
  | "runtime";

export interface AuroraCommand {
  readonly id: string;

  readonly activation?:
    CommandActivation;

  register(program: Command): void;
}

const registry =
  new Map<string, AuroraCommand>();

export function registerCommand(
  command: AuroraCommand
): void {
  const commandId =
    command.id.trim();

  if (!commandId) {
    throw new Error(
      "Command registration requires a non-empty identifier."
    );
  }

  if (registry.has(commandId)) {
    throw new Error(
      `Command '${commandId}' is already registered.`
    );
  }

  registry.set(
    commandId,
    command
  );
}

export function getRegisteredCommandIds():
  string[] {
  return [
    ...registry.keys(),
  ];
}

export function getCommandActivation(
  commandId: string
): CommandActivation {
  return registry.get(commandId)
    ?.activation ?? "runtime";
}

export function registerAllCommands(
  program: Command
): void {
  for (const command of registry.values()) {
    command.register(program);
  }
}
