import fs from "node:fs/promises";
import path from "node:path";

import {
  FileTransaction,
} from "../../core/fileTransaction.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export class FeatureInstallContext {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(
    projectPath: string,
    public readonly transaction =
      new FileTransaction(
        "feature installation"
      )
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
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

  async writeFile(
    relativePath: string,
    content: string
  ): Promise<void> {
    const file =
      this.resolveProjectPath(
        relativePath
      );

    await this.transaction
      .recordModifiedFile(file);

    await this.transaction
      .ensureDirectory(
        path.dirname(file)
      );

    await fs.writeFile(
      file,
      content,
      "utf8"
    );
  }

  async writeJson(
    relativePath: string,
    value: unknown
  ): Promise<void> {
    await this.writeFile(
      relativePath,
      JSON.stringify(
        value,
        null,
        2
      ) + "\n"
    );
  }
}
