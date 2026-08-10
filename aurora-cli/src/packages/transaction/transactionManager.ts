import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export interface Transaction {
  id: string;

  package: string;

  fromVersion: string;

  toVersion: string;

  status:
    | "started"
    | "completed"
    | "failed"
    | "rolled_back";

  startedAt: string;

  finishedAt?: string;

  backup?: string;
}

export class TransactionManager {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async create(
    transaction: Transaction
  ): Promise<void> {
    await this.ensureFolder();

    const file =
      this.getTransactionPath(
        transaction.id
      );

    await fs.writeFile(
      file,
      JSON.stringify(
        transaction,
        null,
        2
      )
    );
  }

  async update(
    id: string,
    data: Partial<Transaction>
  ): Promise<void> {
    await this.ensureFolder();

    const file =
      this.getTransactionPath(id);

    const content =
      await fs.readFile(
        file,
        "utf8"
      );

    const transaction =
      JSON.parse(content);

    await fs.writeFile(
      this.getTransactionPath(id),
      JSON.stringify(
        {
          ...transaction,
          ...data,
        },
        null,
        2
      )
    );
  }

  private async ensureFolder():
    Promise<void> {
    await fs.mkdir(
      this.pathBoundary.resolve(
        ".aurora/transactions"
      ),
      {
        recursive: true,
      }
    );

    this.pathBoundary.resolve(
      ".aurora/transactions"
    );
  }

  private getTransactionPath(
    id: string
  ): string {
    return this.pathBoundary.resolve(
      path.join(
        ".aurora",
        "transactions",
        `${id}.json`
      )
    );
  }
}
