import {
  exec,
} from "node:child_process";

import {
  logger,
} from "../core/logger.js";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

export type DoctorChecker =
  (
    command: string
  ) => Promise<boolean>;

async function checkCommand(
  command: string
): Promise<boolean> {
  return new Promise(
    (resolve) => {
      exec(
        command,
        (error) => {
          resolve(!error);
        }
      );
    }
  );
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
      command:
        "git --version",
    },
    {
      name: "Node.js",
      command:
        "node --version",
    },
    {
      name: "npm",
      command:
        "npm --version",
    },
  ];

  const failedChecks:
    string[] = [];

  for (
    const checkItem
    of checks
  ) {
    const ok =
      await checker(
        checkItem.command
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