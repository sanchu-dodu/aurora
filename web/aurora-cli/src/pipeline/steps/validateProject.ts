import fs from "fs-extra";

export class ValidateProjectStep {

  name = "Validate Project";

  constructor(
    private projectPath: string
  ) {}

  async execute(): Promise<void> {

    if (await fs.pathExists(this.projectPath)) {

      throw new Error(
        `Project '${this.projectPath}' already exists.`
      );

    }

  }

}