import fs from "fs/promises";

import { TransactionManager } from "./transactionManager.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageOwnershipRecorder,
} from "../state/packageOwnershipRecorder.js";

export class EnvContext {
  constructor(
    private pathBoundary:
      ProjectPathBoundary,
    private transaction:
      TransactionManager,
    private ownershipRecorder?:
      PackageOwnershipRecorder
  ) {}

  async addVariables(
    variables: string[]
  ): Promise<void> {
    const file =
      this.pathBoundary.resolve(
        ".env.example"
      );

    await this.transaction
      .recordModifiedFile(
        file
      );

    let content = "";

    try {
      content =
        await fs.readFile(
          file,
          "utf8"
        );
    }
    catch {
      content = "";
    }

    for (
      const variable
      of variables
    ) {
      const introduced =
        !content.includes(
          `${variable}=`
        );

      if (introduced) {
        content +=
          `${variable}=\n`;
      }

      this.ownershipRecorder
        ?.recordEnvironment(
          variable,
          introduced
        );
    }

    await fs.writeFile(
      this.pathBoundary.resolve(
        ".env.example"
      ),
      content
    );

    console.log(
      "Updated .env.example"
    );
  }
}