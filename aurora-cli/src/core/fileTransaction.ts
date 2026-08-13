import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

import {
  redactText,
} from "../security/secretRedactor.js";

export class FileTransaction {
  private readonly originalFiles =
    new Map<
      string,
      {
        readonly content: Buffer;
        readonly mode: number;
      } | null
    >();

  private readonly originalDirectoryModes =
    new Map<string, number>();

  private readonly createdDirectories =
    new Set<string>();

  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(
    private readonly operationName:
      string,
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  recordCreatedFile(
    file: string
  ): void {
    const resolvedFile =
      this.validateFile(file);

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
      this.validateFile(file);

    if (
      this.originalFiles.has(
        resolvedFile
      )
    ) {
      return;
    }

    try {
      const information =
        await fs.lstat(
          resolvedFile
        );

      if (
        information.isSymbolicLink() ||
        !information.isFile()
      ) {
        throw new Error(
          `Path is not a regular file: ${resolvedFile}`
        );
      }

      const content =
        await fs.readFile(
          resolvedFile
        );

      this.originalFiles.set(
        resolvedFile,
        {
          content,
          mode:
            information.mode &
            0o777,
        }
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

  async recordDirectoryMode(
    directory: string
  ): Promise<void> {
    const resolvedDirectory =
      this.pathBoundary
        .validateAbsolutePath(
          path.resolve(directory),
          true
        );

    if (
      this.originalDirectoryModes
        .has(resolvedDirectory)
    ) {
      return;
    }

    try {
      const information =
        await fs.lstat(
          resolvedDirectory
        );

      if (
        information.isSymbolicLink() ||
        !information.isDirectory()
      ) {
        throw new Error(
          `Path is not a regular directory: ${resolvedDirectory}`
        );
      }

      this.originalDirectoryModes.set(
        resolvedDirectory,
        information.mode & 0o777
      );
    } catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  async ensureDirectory(
    directory: string
  ): Promise<void> {
    const resolvedDirectory =
      this.pathBoundary
        .validateAbsolutePath(
          path.resolve(directory),
          true
        );

    if (
      resolvedDirectory ===
      this.pathBoundary.projectRoot
    ) {
      return;
    }

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
      this.pathBoundary
        .validateAbsolutePath(
          resolvedDirectory
        ),
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
    this.originalDirectoryModes
      .clear();
    this.createdDirectories.clear();
  }

  async rollback(): Promise<void> {
    console.log("");
    console.log(
      redactText(
        `Rolling back ${this.operationName}...`
      )
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
          const validatedFile =
            this.validateFile(file);

          await fs.rm(
            validatedFile,
            {
              force: true,
            }
          );

          console.log(
            redactText(
              `Removed ${file}`
            )
          );

          continue;
        }

        const validatedFile =
          this.validateFile(file);

        await fs.mkdir(
          path.dirname(
            validatedFile
          ),
          {
            recursive: true,
          }
        );

        const revalidatedFile =
          this.validateFile(file);

        await fs.writeFile(
          revalidatedFile,
          originalContent.content
        );

        await fs.chmod(
          revalidatedFile,
          originalContent.mode
        );

        console.log(
          redactText(
            `Restored ${file}`
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          redactText(
            `Rollback warning for ${file}: ${message}`
          )
        );
      }
    }

    const directoryModes =
      Array.from(
        this.originalDirectoryModes
          .entries()
      ).reverse();

    for (
      const [directory, mode]
      of directoryModes
    ) {
      try {
        const validatedDirectory =
          this.pathBoundary
            .validateAbsolutePath(
              directory,
              true
            );

        await fs.chmod(
          validatedDirectory,
          mode
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          redactText(
            `Rollback warning for ${directory}: ${message}`
          )
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
        const validatedDirectory =
          this.pathBoundary
            .validateAbsolutePath(
              directory
            );

        await fs.rmdir(
          validatedDirectory
        );
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
            redactText(
              `Rollback warning for ${directory}: ${message}`
            )
          );
        }
      }
    }

    this.commit();
  }

  private validateFile(
    file: string
  ): string {
    return this.pathBoundary
      .validateAbsolutePath(
        path.resolve(file)
      );
  }
}

