import fs from "fs-extra";
import path from "path";

export class Generator {

  async generateFile(

    outputPath: string,

    content: string

  ): Promise<void> {

    await fs.ensureDir(
      path.dirname(outputPath)
    );

    await fs.writeFile(
      outputPath,
      content
    );

  }

}