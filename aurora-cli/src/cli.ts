import {
  Command,
  CommanderError,
} from "commander";

import {
  getCommandActivation,
  registerAllCommands,
  type CommandActivation,
} from "./core/commandRegistry.js";

import {
  AURORA_CLI_VERSION,
} from "./core/packageMetadata.js";

import {
  applyCliOutputPolicy,
  resolveCliOutputOptions,
} from "./core/outputPolicy.js";

import {
  AuroraCliActivation,
  type CliActivation,
} from "./runtime/cliActivation.js";

import {
  showBanner,
} from "./utils/banner.js";

function getCommandPath(
  program: Command,
  actionCommand: Command
): string[] {
  const path: string[] = [];

  let command:
    Command | undefined =
      actionCommand;

  while (
    command &&
    command !== program
  ) {
    path.unshift(
      command.name()
    );

    command =
      command.parent ??
      undefined;
  }

  return path;
}

function resolveCommandActivation(
  program: Command,
  actionCommand: Command
): CommandActivation {
  if (
    actionCommand.name() ===
    "help"
  ) {
    return "none";
  }

  const commandPath =
    getCommandPath(
      program,
      actionCommand
    );

  const [
    commandId,
    ...subcommandPath
  ] = commandPath;

  if (!commandId) {
    return "runtime";
  }

  return getCommandActivation(
    commandId,
    subcommandPath
  );
}

export function createCliProgram():
  Command {
  const program =
    new Command();

  program
    .name("aurora")
    .description(
      "Aurora Command Line Interface"
    )
    .version(AURORA_CLI_VERSION)
    .option(
      "-q, --quiet",
      "Suppress normal command output"
    )
    .option(
      "--no-color",
      "Disable ANSI color and terminal styling"
    )
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
  const outputPolicy =
    applyCliOutputPolicy(
      resolveCliOutputOptions(argv)
    );

  try {
    const program =
      createCliProgram();

    let runtimeActivationAttempted =
      false;

    program.hook(
      "preAction",
      async (
        _thisCommand,
        actionCommand
      ) => {
        const activationMode =
          resolveCommandActivation(
            program,
            actionCommand
          );

        if (
          activationMode ===
          "none"
        ) {
          return;
        }

        if (
          activationMode ===
          "catalog"
        ) {
          await activation
            .prepareCatalog();

          return;
        }

        showBanner();

        runtimeActivationAttempted =
          true;

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

    if (
      runtimeActivationAttempted
    ) {
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
  } finally {
    outputPolicy.restore();
  }
}
