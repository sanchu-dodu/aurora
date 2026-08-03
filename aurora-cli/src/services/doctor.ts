import {
  exec,
} from "node:child_process";

import {
  logger,
} from "../core/logger.js";

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
  logger.title("Aurora Doctor");
  console.log("========================");

  const checks = [
    {
      name: "Git",
      command: "git --version",
    },
    {
      name: "Node.js",
      command: "node --version",
    },
    {
      name: "npm",
      command: "npm --version",
    },
  ];

  const failedChecks: string[] = [];

  for (const checkItem of checks) {
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

  if (failedChecks.length > 0) {
    throw new Error(
      `Doctor checks failed: ${failedChecks.join(", ")}.`
    );
  }
}