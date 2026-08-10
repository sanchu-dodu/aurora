import {
  Argument,
  Command,
} from "commander";

import {
  registerCommand,
} from "../core/commandRegistry.js";

import {
  COMPLETION_SHELLS,
  generateCompletionScript,
  type CompletionShell,
} from "../services/completion.js";

registerCommand({
  id: "completion",
  activation: "none",

  register(
    program: Command
  ): void {
    program
      .command("completion")
      .description(
        "Generate shell completion setup"
      )
      .addArgument(
        new Argument(
          "<shell>",
          "Shell to generate completion for"
        ).choices([
          ...COMPLETION_SHELLS,
        ])
      )
      .action(
        (shell: CompletionShell) => {
          process.stdout.write(
            generateCompletionScript(
              program,
              shell
            )
          );
        }
      );
  },
});
