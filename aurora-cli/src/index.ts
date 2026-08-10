#!/usr/bin/env node
import {
  CommanderError,
} from "commander";

import "./commands/initRegistration.js";
import "./commands/doctorRegistration.js";
import "./commands/listRegistration.js";
import "./commands/pluginRegistration.js";
import "./commands/configRegistration.js";
import "./commands/templateRegistration.js";
import "./commands/featureRegistration.js";
import "./commands/generateRegistration.js";
import "./commands/packageRegistration.js";
import "./commands/recoveryRegistration.js";
import "./commands/completionRegistration.js";

import {
  runCli,
} from "./cli.js";

import {
  formatFatalError,
} from "./errors/formatError.js";

function handleFatalError(
  error: unknown
): void {
  if (
    error instanceof
    CommanderError
  ) {
    process.exitCode =
      error.exitCode;

    return;
  }

  console.error(
    formatFatalError(error)
  );

  process.exitCode = 1;
}

try {
  await runCli();
} catch (error) {
  handleFatalError(error);
}
