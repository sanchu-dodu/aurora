import fs from "node:fs/promises";
import path from "node:path";

import {
  FileTransaction,
} from "../../core/fileTransaction.js";

export class FeatureInstallContext {
  private readonly projectRoot:
    string;

  constructor(
    projectPath: string,
    public readonly transaction =
      new FileTransaction(
        "feature installation"
      )
  ) {
    this.projectRoot =
      path.resolve(projectPath);
  }

  getProjectPath(): string {
    return this.projectRoot;
  }

  resolveProjectPath(
    relativePath: string
  ): string {
    if (
      !relativePath.trim() ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        `Invalid feature path '${relativePath}'.`
      );
    }

    const candidate =
      path.resolve(
        this.projectRoot,
        relativePath
      );

    const relative =
      path.relative(
        this.projectRoot,
        candidate
      );

    const escapesProject =
      relative === ".." ||
      relative.startsWith(
        `..${path.sep}`
      ) ||
      path.isAbsolute(relative);

    if (escapesProject) {
      throw new Error(
        `Feature path escapes the project root: ${relativePath}`
      );
    }

    return candidate;
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
