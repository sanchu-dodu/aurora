import type {
  Command,
} from "commander";

export type CommandActivation =
  | "none"
  | "catalog"
  | "runtime";

export interface AuroraCommand {
  readonly id: string;

  readonly activation?:
    CommandActivation;

  readonly subcommandActivations?:
    Readonly<
      Record<
        string,
        CommandActivation
      >
    >;

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
  commandId: string,
  subcommandPath:
    readonly string[] = []
): CommandActivation {
  const command =
    registry.get(commandId);

  if (!command) {
    return "runtime";
  }

  if (subcommandPath.length > 0) {
    const path =
      subcommandPath.join(" ");

    const activation =
      command
        .subcommandActivations
        ?.[path];

    if (activation) {
      return activation;
    }
  }

  return command.activation ??
    "runtime";
}

export function registerAllCommands(
  program: Command
): void {
  for (
    const command
    of registry.values()
  ) {
    command.register(program);
  }
}
