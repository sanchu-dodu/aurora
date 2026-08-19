import fs from "fs/promises";

import { TransactionManager } from "./transactionManager.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageOwnershipRecorder,
} from "../state/packageOwnershipRecorder.js";

export class ConfigContext {
  constructor(
    private pathBoundary:
      ProjectPathBoundary,
    private transaction:
      TransactionManager,
    private ownershipRecorder?:
      PackageOwnershipRecorder
  ) {}

  async updatePackageJson(
    updater: (json: any) => void
  ): Promise<void> {
    const packageJsonPath =
      this.pathBoundary.resolve(
        "package.json"
      );

    await this.transaction
      .recordModifiedFile(
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
    let previousVersion:
      string | null = null;

    await this.updatePackageJson(
      (json) => {
        json.dependencies ??= {};

        const previous =
          json.dependencies[
            packageName
          ];

        if (
          previous !== undefined &&
          typeof previous !==
            "string"
        ) {
          throw new TypeError(
            `Dependency '${packageName}' has an invalid existing version.`
          );
        }

        previousVersion =
          previous ?? null;

        json.dependencies[
          packageName
        ] = version;
      }
    );

    this.ownershipRecorder
      ?.recordDependency(
        packageName,
        version,
        previousVersion
      );

    console.log(
      `Added dependency ${packageName}`
    );
  }
}