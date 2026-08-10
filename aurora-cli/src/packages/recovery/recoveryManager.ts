import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export interface RecoveryTransaction {
  id: string;

  package: string;

  fromVersion: string;

  toVersion: string;

  status: string;

  backup?: string;
}

export class RecoveryManager {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async findIncomplete(): Promise<
    RecoveryTransaction[]
  > {
    try {
      const files =
        await fs.readdir(
          this.pathBoundary.resolve(
            ".aurora/transactions"
          )
        );

      const transactions:
        RecoveryTransaction[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }

        const content =
          await fs.readFile(
            this.pathBoundary.resolve(
              path.join(
                ".aurora",
                "transactions",
                file
              )
            ),
            "utf8"
          );

        const transaction =
          JSON.parse(content) as
            RecoveryTransaction;

        if (
          transaction.status ===
          "started"
        ) {
          transactions.push(
            transaction
          );
        }
      }

      return transactions;
    } catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}
