import fs from "fs-extra";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export class RollbackService {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async deleteFiles(
    files: string[]
  ): Promise<void> {
    for (const file of files) {
      const target =
        this.pathBoundary.resolve(file);

      if (await fs.pathExists(target)) {
        await fs.remove(
          this.pathBoundary.resolve(
            file
          )
        );
      }
    }
  }
}
