import fs from "node:fs/promises";
import path from "node:path";

import {
  BACKUP_FILES,
} from "../backup/backupManager.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export class RollbackManager {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async rollback(
    backupPath: string
  ): Promise<void> {
    const backupRoot =
      this.pathBoundary.resolve(
        ".aurora/backups"
      );

    const backupRootBoundary =
      new ProjectPathBoundary(
        backupRoot
      );

    const backupFolder =
      path.isAbsolute(backupPath)
        ? backupRootBoundary
            .validateAbsolutePath(
              path.resolve(
                backupPath
              )
            )
        : backupRootBoundary
            .resolve(backupPath);

    const backupBoundary =
      new ProjectPathBoundary(
        backupFolder
      );

    for (const file of BACKUP_FILES) {
      const source =
        backupBoundary.resolve(file);

      try {
        await fs.access(source);
      } catch (error) {
        const code =
          (
            error as NodeJS.ErrnoException
          ).code;

        if (code === "ENOENT") {
          continue;
        }

        throw error;
      }

      const destination =
        this.pathBoundary.resolve(
          file
        );

      await fs.mkdir(
        path.dirname(destination),
        {
          recursive: true,
        }
      );

      await fs.copyFile(
        backupBoundary.resolve(file),
        this.pathBoundary.resolve(
          file
        )
      );
    }

    console.log(
      "Rollback completed successfully."
    );
  }
}
