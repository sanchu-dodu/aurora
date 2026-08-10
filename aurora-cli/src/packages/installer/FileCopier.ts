import fs from "fs-extra";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export class FileCopier {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async copy(
    source: string,
    relativeDestination: string
  ): Promise<void> {
    const destination =
      this.pathBoundary.resolve(
        relativeDestination
      );

    await fs.ensureDir(
      path.dirname(destination)
    );

    await fs.copy(
      source,
      this.pathBoundary.resolve(
        relativeDestination
      ),
      {
        dereference: true,
      }
    );
  }
}
