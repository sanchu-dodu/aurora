import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { doctorCommand } from "./doctor.js";

registerCommand({
  id: "doctor",
  activation: "none",
  register(program: Command) {
    program
      .command("doctor")
      .description("Read-only development environment and project diagnostics")
      .option("--project <path>", "Inspect this project root", ".")
      .option("--json", "Print the versioned diagnostic report as JSON")
      .option("--strict", "Treat warnings as failures")
      .action(async (options: { project: string; json?: boolean; strict?: boolean }) => {
        await doctorCommand({ projectRoot: options.project, json: options.json, strict: options.strict });
      });
  },
});
