import fs from "node:fs/promises";
import path from "node:path";

export class FileTransaction {
  private readonly originalFiles =
    new Map<string, Buffer | null>();

  private readonly createdDirectories =
    new Set<string>();

  constructor(
    private readonly operationName =
      "operation"
  ) {}

  recordCreatedFile(
    file: string
  ): void {
    const resolvedFile =
      path.resolve(file);

    if (
      !this.originalFiles.has(
        resolvedFile
      )
    ) {
      this.originalFiles.set(
        resolvedFile,
        null
      );
    }
  }

  async recordModifiedFile(
    file: string
  ): Promise<void> {
    const resolvedFile =
      path.resolve(file);

    if (
      this.originalFiles.has(
        resolvedFile
      )
    ) {
      return;
    }

    try {
      const content =
        await fs.readFile(
          resolvedFile
        );

      this.originalFiles.set(
        resolvedFile,
        content
      );
    } catch (error) {
      const code =
        (
          error as NodeJS.ErrnoException
        ).code;

      if (code === "ENOENT") {
        this.originalFiles.set(
          resolvedFile,
          null
        );

        return;
      }

      throw error;
    }
  }

  async ensureDirectory(
    directory: string
  ): Promise<void> {
    const resolvedDirectory =
      path.resolve(directory);

    const missingDirectories:
      string[] = [];

    let current =
      resolvedDirectory;

    while (true) {
      try {
        const information =
          await fs.stat(current);

        if (
          !information.isDirectory()
        ) {
          throw new Error(
            `Path is not a directory: ${current}`
          );
        }

        break;
      } catch (error) {
        const code =
          (
            error as NodeJS.ErrnoException
          ).code;

        if (code !== "ENOENT") {
          throw error;
        }

        missingDirectories.push(
          current
        );

        const parent =
          path.dirname(current);

        if (parent === current) {
          break;
        }

        current = parent;
      }
    }

    await fs.mkdir(
      resolvedDirectory,
      {
        recursive: true,
      }
    );

    for (
      const missingDirectory of
      missingDirectories
    ) {
      this.createdDirectories.add(
        missingDirectory
      );
    }
  }

  commit(): void {
    this.originalFiles.clear();
    this.createdDirectories.clear();
  }

  async rollback(): Promise<void> {
    console.log("");
    console.log(
      `Rolling back ${this.operationName}...`
    );

    const files =
      Array.from(
        this.originalFiles.entries()
      ).reverse();

    for (
      const [
        file,
        originalContent,
      ] of files
    ) {
      try {
        if (
          originalContent === null
        ) {
          await fs.rm(
            file,
            {
              force: true,
            }
          );

          console.log(
            `Removed ${file}`
          );

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
          originalContent
        );

        console.log(
          `Restored ${file}`
        );
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

    const directories =
      Array.from(
        this.createdDirectories
      ).sort(
        (left, right) =>
          right.length -
          left.length
      );

    for (
      const directory of directories
    ) {
      try {
        await fs.rmdir(directory);
      } catch (error) {
        const code =
          (
            error as NodeJS.ErrnoException
          ).code;

        if (
          code !== "ENOENT" &&
          code !== "ENOTEMPTY"
        ) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          console.error(
            `Rollback warning for ${directory}: ${message}`
          );
        }
      }
    }

    this.commit();
  }
}

