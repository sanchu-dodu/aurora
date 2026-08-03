import fs from "node:fs/promises";
import path from "node:path";

export class TransactionManager {
  private readonly originalFiles =
    new Map<string, string | null>();

  recordCreatedFile(file: string): void {
    if (!this.originalFiles.has(file)) {
      this.originalFiles.set(file, null);
    }
  }

  async recordModifiedFile(
    file: string
  ): Promise<void> {
    if (this.originalFiles.has(file)) {
      return;
    }

    try {
      const content = await fs.readFile(
        file,
        "utf8"
      );

      this.originalFiles.set(
        file,
        content
      );
    } catch (error) {
      const code =
        (error as NodeJS.ErrnoException).code;

      if (code === "ENOENT") {
        this.originalFiles.set(file, null);
        return;
      }

      throw error;
    }
  }

  async rollback(): Promise<void> {
    console.log("");
    console.log(
      "Rolling back installation..."
    );

    const entries =
      Array.from(
        this.originalFiles.entries()
      ).reverse();

    for (const [file, originalContent] of entries) {
      try {
        if (originalContent === null) {
          await fs.rm(
            file,
            {
              force: true,
            }
          );

          console.log(`Removed ${file}`);
          continue;
        }

        await fs.mkdir(
          path.dirname(file),
          {
            recursive: true,
          }
        );

        await fs.writeFile(
          file,
          originalContent,
          "utf8"
        );

        console.log(`Restored ${file}`);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          `Rollback warning for ${file}: ${message}`
        );
      }
    }

    this.originalFiles.clear();
  }
}
