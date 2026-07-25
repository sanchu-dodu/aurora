import fs from "fs/promises";
import path from "path";

export class InstallerContext {

  constructor(
    private projectPath: string
  ) {}

  log(
    message: string
  ): void {

    console.log(
      message
    );

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


    console.log(
      `Created ${filePath}`
    );

  }

}