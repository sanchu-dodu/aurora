import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { doctorCommand } from "./doctor.js";

registerCommand({
  register(program: Command) {
    program
      .command("doctor")
      .description("Check Aurora development environment")
      .action(async () => {
        await doctorCommand();
      });
  },
});