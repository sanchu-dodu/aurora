import fs from "fs/promises";
import { TransactionManager } from "./transactionManager.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export class ConfigContext {

  constructor(
    private pathBoundary: ProjectPathBoundary,
    private transaction: TransactionManager
  ) {}

  async updatePackageJson(
    updater: (json: any) => void
  ): Promise<void> {

    const packageJsonPath =
      this.pathBoundary.resolve(
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
      this.pathBoundary.resolve(
        "package.json"
      ),
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
