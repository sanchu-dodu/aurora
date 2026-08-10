import fs from "fs-extra";
import path from "path";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

export class Generator {

  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(projectPath: string) {

    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );

  }

  async generateFile(

    relativeOutputPath: string,

    content: string

  ): Promise<void> {

    const outputPath =
      this.pathBoundary.resolve(
        relativeOutputPath
      );

    await fs.ensureDir(
      path.dirname(outputPath)
    );

    const validatedOutputPath =
      this.pathBoundary.resolve(
        relativeOutputPath
      );

    await fs.writeFile(
      validatedOutputPath,
      content
    );

  }

}
