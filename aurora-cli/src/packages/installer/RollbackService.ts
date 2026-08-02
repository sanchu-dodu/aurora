import fs from "fs-extra";

export class RollbackService {

  async deleteFiles(
    files: string[]
  ): Promise<void> {

    for (const file of files) {

      if (await fs.pathExists(file)) {

        await fs.remove(file);

      }

    }

  }

}