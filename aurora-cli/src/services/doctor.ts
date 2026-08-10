import {
  logger,
} from "../core/logger.js";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  runProcess,
} from "./processService.js";

import type {
  SafeProcessCommand,
} from "./processService.js";

export interface DoctorCommand {
  command: SafeProcessCommand;

  args: readonly string[];
}

export type DoctorChecker =
  (
    command: DoctorCommand
  ) => Promise<boolean>;

async function checkCommand(
  command: DoctorCommand
): Promise<boolean> {
  try {
    const result =
      await runProcess({
        command:
          command.command,
        args:
          command.args,
        cwd: process.cwd(),
        output: "ignore",
        timeoutMs: 10_000,
        rejectOnNonZero:
          false,
      });

    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function runDoctor(
  checker:
    DoctorChecker = checkCommand
): Promise<void> {
  console.log("");

  logger.title(
    "Aurora Doctor"
  );

  console.log(
    "========================"
  );

  const checks = [
    {
      name: "Git",
      process: {
        command: "git",
        args: [
          "--version",
        ],
      },
    },
    {
      name: "Node.js",
      process: {
        command: "node",
        args: [
          "--version",
        ],
      },
    },
    {
      name: "npm",
      process: {
        command: "npm",
        args: [
          "--version",
        ],
      },
    },
  ] satisfies Array<{
    name: string;
    process: DoctorCommand;
  }>;

  const failedChecks:
    string[] = [];

  for (
    const checkItem
    of checks
  ) {
    const ok =
      await checker(
        checkItem.process
      );

    if (ok) {
      logger.success(
        `✅ ${checkItem.name}`
      );
    } else {
      logger.error(
        `❌ ${checkItem.name}`
      );

      failedChecks.push(
        checkItem.name
      );
    }
  }

  console.log("");

  if (
    failedChecks.length > 0
  ) {
    throw new AuroraError(
      `Doctor checks failed: ${failedChecks.join(", ")}.`,
      {
        code:
          ErrorCodes
            .DOCTOR_CHECK_FAILED,

        suggestion:
          "Install or repair the failed development tools, then run 'aurora doctor' again.",
      }
    );
  }
}
