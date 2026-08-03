import fs from "node:fs/promises";
import path from "node:path";

import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";
import { TransactionManager } from "./transactionManager.js";

export class InstallerContext {
  public readonly transaction: TransactionManager;

  public readonly config: ConfigContext;

  public readonly env: EnvContext;

  constructor(
    private readonly projectPath: string
  ) {
    this.transaction =
      new TransactionManager();

    this.config =
      new ConfigContext(
        projectPath,
        this.transaction
      );

    this.env =
      new EnvContext(
        projectPath,
        this.transaction
      );
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  log(message: string): void {
    console.log(message);
  }

  async createFile(
    filePath: string,
    content: string
  ): Promise<void> {
    const fullPath = path.join(
      this.projectPath,
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
