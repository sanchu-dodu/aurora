import fs from "fs-extra";
import path from "path";

export class ConfigureAuroraStep {

  name = "Configure Aurora";

  constructor(
    private projectName: string
  ) {}

  async execute(): Promise<void> {

    const auroraDir = path.join(
      this.projectName,
      ".aurora"
    );

    await fs.ensureDir(
      auroraDir
    );

    await fs.writeJson(
      path.join(
        auroraDir,
        "config.json"
      ),
      {
        framework: "nextjs",
        version: "1.0.0"
      },
      {
        spaces: 2
      }
    );

  }

  async rollback(): Promise<void> {

    const auroraDir = path.join(
      this.projectName,
      ".aurora"
    );

    if (
      await fs.pathExists(
        auroraDir
      )
    ) {

      await fs.remove(
        auroraDir
      );

      console.log(
        "Removed Aurora configuration."
      );

    }

  }

}