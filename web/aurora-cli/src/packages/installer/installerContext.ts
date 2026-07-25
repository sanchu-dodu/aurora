import fs from "fs/promises";
import path from "path";
import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";


export class InstallerContext {

  config: ConfigContext;
  env: EnvContext;


  constructor(
    private projectPath: string
  ) {

    this.config =
      new ConfigContext(
        projectPath
      );


    this.env =
      new EnvContext(
        projectPath
      );

  }


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