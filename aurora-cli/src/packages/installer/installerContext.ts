import fs from "node:fs/promises";
import path from "node:path";

import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";
import { TransactionManager } from "./transactionManager.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export class InstallerContext {
  public readonly transaction: TransactionManager;

  public readonly config: ConfigContext;

  public readonly env: EnvContext;

  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );

    this.transaction =
      new TransactionManager();

    this.config =
      new ConfigContext(
        this.pathBoundary,
        this.transaction
      );

    this.env =
      new EnvContext(
        this.pathBoundary,
        this.transaction
      );
  }

  getProjectPath(): string {
    return this.pathBoundary
      .projectRoot;
  }

  resolveProjectPath(
    relativePath: string
  ): string {
    return this.pathBoundary
      .resolve(relativePath);
  }

  log(message: string): void {
    console.log(message);
  }

  async createFile(
    filePath: string,
    content: string
  ): Promise<void> {
    const fullPath =
      this.resolveProjectPath(
        filePath
      );

    await this.transaction.recordModifiedFile(
      fullPath
    );

    await fs.mkdir(
      path.dirname(fullPath),
      {
        recursive: true,
      }
    );

    await fs.writeFile(
      fullPath,
      content,
      "utf8"
    );

    console.log(`Created ${filePath}`);
  }
}
