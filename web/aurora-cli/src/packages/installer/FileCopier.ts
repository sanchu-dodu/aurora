import fs from "fs-extra";
import path from "path";

export class FileCopier {

  async copy(
    source: string,
    destination: string
  ): Promise<void> {

    await fs.ensureDir(
      path.dirname(destination)
    );

    await fs.copy(
      source,
      destination
    );

  }

}