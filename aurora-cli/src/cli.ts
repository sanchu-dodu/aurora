import {
  Command,
  CommanderError,
} from "commander";

import {
  getCommandActivation,
  registerAllCommands,
} from "./core/commandRegistry.js";

import {
  AURORA_CLI_VERSION,
} from "./core/packageMetadata.js";

import {
  AuroraCliActivation,
  type CliActivation,
} from "./runtime/cliActivation.js";

import {
  showBanner,
} from "./utils/banner.js";

function getTopLevelCommandId(
  program: Command,
  actionCommand: Command
): string | undefined {
  let command = actionCommand;

  while (
    command.parent &&
    command.parent !== program
  ) {
    command = command.parent;
  }

  if (command === program) {
    return undefined;
  }

  return command.name();
}

function requiresActivation(
  program: Command,
  actionCommand: Command
): boolean {
  if (
    actionCommand.name() ===
    "help"
  ) {
    return false;
  }

  const commandId =
    getTopLevelCommandId(
      program,
      actionCommand
    );

  if (commandId === "help") {
    return false;
  }

  if (!commandId) {
    return true;
  }

  return getCommandActivation(
    commandId
  ) === "runtime";
}

export function createCliProgram():
  Command {
  const program = new Command();

  program
    .name("aurora")
    .description(
      "Aurora Command Line Interface"
    )
    .version(AURORA_CLI_VERSION)
    .helpCommand(true)
    .exitOverride();

  program.action(() => {
    console.log(
      "Aurora CLI started successfully."
    );
  });

  registerAllCommands(program);

  return program;
}

export async function runCli(
  argv: readonly string[] =
    process.argv,
  activation: CliActivation =
    new AuroraCliActivation()
): Promise<void> {
  const program = createCliProgram();

  let activationAttempted = false;

  program.hook(
    "preAction",
    async (
      _thisCommand,
      actionCommand
    ) => {
      if (
        !requiresActivation(
          program,
          actionCommand
        )
      ) {
        return;
      }

      showBanner();

      activationAttempted = true;

      await activation.activate();
    }
  );

  let operationError:
    unknown;

  try {
    await program.parseAsync([
      ...argv,
    ]);
  } catch (error) {
    const successfulCommanderExit =
      error instanceof
        CommanderError &&
      error.exitCode === 0;

    if (
      !successfulCommanderExit
    ) {
      operationError = error;
    }
  }

  if (activationAttempted) {
    try {
      await activation.shutdown();
    } catch (shutdownError) {
      if (operationError) {
        throw new AggregateError(
          [
            operationError,
            shutdownError,
          ],
          "The CLI operation and Kernel shutdown both failed."
        );
      }

      throw shutdownError;
    }
  }

  if (operationError) {
    throw operationError;
  }
}
