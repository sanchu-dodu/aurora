import fs from "fs/promises";
import path from "path";

export interface LockFile {

  packages: Record<string, string>;

}

export class LockManager {

  constructor(
    private projectPath: string
  ) {}

  private get lockFile(): string {

    return path.join(
      this.projectPath,
      "aurora.lock"
    );

  }

  async read(): Promise<LockFile> {

    try {

      const content =
        await fs.readFile(
          this.lockFile,
          "utf8"
        );

      return JSON.parse(content);

    } catch {

      return {

        packages: {}

      };

    }

  }

  async write(
    lock: LockFile
  ): Promise<void> {

    await fs.writeFile(

      this.lockFile,

      JSON.stringify(
        lock,
        null,
        2
      )

    );

  }

  async register(

    packageName: string,

    version: string

  ): Promise<void> {

    const lock =
      await this.read();

    lock.packages[
      packageName
    ] = version;

    await this.write(
      lock
    );

  }

}