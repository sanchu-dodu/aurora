import fs from "fs/promises";
import path from "path";
import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";
import { TransactionManager } from "./transactionManager.js";

export class InstallerContext {

  public readonly transaction: TransactionManager;

  public readonly config: ConfigContext;

  public readonly env: EnvContext;

  constructor(
    private projectPath: string
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

  log(
    message: string
  ): void {

    console.log(message);

  }

  async createFile(
    filePath: string,
    content: string
  ): Promise<void> {

    const fullPath =
      path.join(
        this.projectPath,
        filePath
      );

    await fs.mkdir(
      path.dirname(fullPath),
      {
        recursive: true
      }
    );

    await fs.writeFile(
      fullPath,
      content
    );

    this.transaction.recordCreatedFile(
      fullPath
    );

    console.log(
      `Created ${filePath}`
    );

  }

}