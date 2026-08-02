import fs from "fs/promises";

export class TransactionManager {

  private createdFiles: string[] = [];

  private modifiedFiles = new Map<
    string,
    string
  >();

  recordCreatedFile(
    file: string
  ): void {

    this.createdFiles.push(file);

  }

  async recordModifiedFile(
    file: string
  ): Promise<void> {

    if (this.modifiedFiles.has(file)) {

      return;

    }

    try {

      const content =
        await fs.readFile(
          file,
          "utf8"
        );

      this.modifiedFiles.set(
        file,
        content
      );

    } catch {

      // File didn't exist before

    }

  }

  async rollback(): Promise<void> {

    console.log();
    console.log(
      "Rolling back installation..."
    );

    // Remove newly created files

    for (
      const file of this.createdFiles.reverse()
    ) {

      try {

        await fs.unlink(file);

        console.log(
          `Removed ${file}`
        );

      } catch {

        // Ignore

      }

    }

    // Restore modified files

    for (
      const [file, content]
      of this.modifiedFiles
    ) {

      try {

        await fs.writeFile(
          file,
          content
        );

        console.log(
          `Restored ${file}`
        );

      } catch {

        // Ignore

      }

    }

  }

}