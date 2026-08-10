import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export const BACKUP_FILES = [
  "package.json",
  ".env.example",
  ".aurora/cache.json",
] as const;

export class BackupManager {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async createBackup(): Promise<string> {
    const backupRootPath =
      ".aurora/backups";

    await fs.mkdir(
      this.pathBoundary.resolve(
        backupRootPath
      ),
      {
        recursive: true,
      }
    );

    const timestamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          "-"
        );

    const backupFolderPath =
      path.join(
        backupRootPath,
        timestamp
      );

    const backupFolder =
      this.pathBoundary.resolve(
        backupFolderPath
      );

    await fs.mkdir(
      backupFolder,
      {
        recursive: true,
      }
    );

    for (const file of BACKUP_FILES) {
      const targetPath =
        path.join(
          backupFolderPath,
          file
        );

      const target =
        this.pathBoundary.resolve(
          targetPath
        );

      try {
        await fs.mkdir(
          path.dirname(target),
          {
            recursive: true,
          }
        );

        await fs.copyFile(
          this.pathBoundary.resolve(
            file
          ),
          this.pathBoundary.resolve(
            targetPath
          )
        );
      } catch (error) {
        const code =
          (
            error as NodeJS.ErrnoException
          ).code;

        if (code !== "ENOENT") {
          throw error;
        }
      }
    }

    return backupFolder;
  }
}
