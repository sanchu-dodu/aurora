import fs from "fs-extra";
import path from "path";

import { runCommand } from "../../services/processService.js";

export class InitializeGitStep {

  name = "Initialize Git";

  constructor(
    private projectName: string
  ) {}

  async execute(): Promise<void> {

    await runCommand(
      "git",
      [
        "init"
      ],
      this.projectName
    );

  }

  async rollback(): Promise<void> {

    const gitFolder = path.join(
      this.projectName,
      ".git"
    );

    if (await fs.pathExists(gitFolder)) {

      await fs.remove(gitFolder);

      console.log(
        "Removed Git repository."
      );

    }

  }

}