import fs from "fs/promises";
import path from "path";
import { TransactionManager } from "./transactionManager.js";

export class ConfigContext {

  constructor(
    private projectPath: string,
    private transaction: TransactionManager
  ) {}

  async updatePackageJson(
    updater: (json: any) => void
  ): Promise<void> {

    const packageJsonPath = path.join(
      this.projectPath,
      "package.json"
    );

    await this.transaction.recordModifiedFile(
      packageJsonPath
    );

    const content =
      await fs.readFile(
        packageJsonPath,
        "utf8"
      );

    const json =
      JSON.parse(content);

    updater(json);

    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(
        json,
        null,
        2
      )
    );

    console.log(
      "Updated package.json"
    );

  }

  async addDependency(
    packageName: string,
    version = "latest"
  ): Promise<void> {

    await this.updatePackageJson(
      (json) => {

        json.dependencies ??= {};

        json.dependencies[packageName] =
          version;

      }
    );

    console.log(
      `Added dependency ${packageName}`
    );

  }

}