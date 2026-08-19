import {
  createHash,
} from "node:crypto";

import type {
  Stats,
} from "node:fs";

import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import type {
  PackageOwnedDependency,
  PackageOwnedEnvironment,
  PackageOwnedFile,
  PackageStateReceipt,
} from "./packageStateSchema.js";

interface PendingFileOwnership {
  readonly path: string;

  readonly action:
    | "created"
    | "modified";

  readonly previousSha256:
    string | null;
}

export class PackageOwnershipRecorder {
  private readonly pathBoundary:
    ProjectPathBoundary;

  private readonly projectRoot:
    string;

  private readonly files =
    new Map<
      string,
      PendingFileOwnership
    >();

  private readonly dependencies =
    new Map<
      string,
      PackageOwnedDependency
    >();

  private readonly environment =
    new Map<
      string,
      PackageOwnedEnvironment
    >();

  constructor(
    projectPath: string,
    private readonly manifest:
      PackageManifest,
    private readonly now:
      () => Date =
        () => new Date()
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );

    this.projectRoot =
      this.pathBoundary.projectRoot;
  }

  async recordFileBefore(
    relativePath: string
  ): Promise<void> {
    const canonicalPath =
      this.canonicalProjectPath(
        relativePath
      );

    const key =
      canonicalPath.toLowerCase();

    if (this.files.has(key)) {
      return;
    }

    const previousSha256 =
      await this.readDigest(
        canonicalPath,
        true
      );

    this.files.set(
      key,
      {
        path:
          canonicalPath,

        action:
          previousSha256 === null
            ? "created"
            : "modified",

        previousSha256,
      }
    );
  }

  recordDependency(
    name: string,
    version: string,
    previousVersion:
      string | null
  ): void {
    const key =
      name.toLowerCase();

    const existing =
      this.dependencies.get(
        key
      );

    if (existing) {
      this.dependencies.set(
        key,
        {
          ...existing,
          version,
        }
      );

      return;
    }

    this.dependencies.set(
      key,
      {
        name,
        version,
        previousVersion,
      }
    );
  }

  recordEnvironment(
    name: string,
    introduced: boolean
  ): void {
    if (this.environment.has(name)) {
      return;
    }

    this.environment.set(
      name,
      {
        name,
        introduced,
      }
    );
  }

  async finalize():
    Promise<PackageStateReceipt> {
    const files:
      PackageOwnedFile[] = [];

    const pendingFiles =
      [...this.files.values()]
        .sort(
          (left, right) =>
            compareText(
              left.path,
              right.path
            )
        );

    for (
      const pending
      of pendingFiles
    ) {
      const sha256 =
        await this.readDigest(
          pending.path,
          false
        );

      if (sha256 === null) {
        throw new Error(
          `Owned package file '${pending.path}' disappeared before lifecycle state could be recorded.`
        );
      }

      files.push({
        path:
          pending.path,

        action:
          pending.action,

        sha256,

        previousSha256:
          pending.previousSha256,
      });
    }

    return {
      id:
        this.manifest.id,

      version:
        this.manifest.version,

      publisherId:
        this.manifest.publisher.id,

      artifactSha256:
        this.manifest.artifact.digest,

      installedAt:
        this.now().toISOString(),

      files,

      dependencies:
        [...this.dependencies.values()]
          .sort(
            (left, right) =>
              compareText(
                left.name,
                right.name
              )
          ),

      environment:
        [...this.environment.values()]
          .sort(
            (left, right) =>
              compareText(
                left.name,
                right.name
              )
          ),
    };
  }

  private canonicalProjectPath(
    relativePath: string
  ): string {
    const resolved =
      this.pathBoundary.resolve(
        relativePath
      );

    const relative =
      path.relative(
        this.projectRoot,
        resolved
      );

    if (
      relative.length === 0 ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(
        `..${path.sep}`
      )
    ) {
      throw new Error(
        `Package ownership path is outside the project: ${relativePath}`
      );
    }

    return relative
      .split(path.sep)
      .join("/");
  }

  private async readDigest(
    relativePath: string,
    allowMissing: boolean
  ): Promise<string | null> {
    const fullPath =
      this.pathBoundary.resolve(
        relativePath
      );

    let handle:
      fs.FileHandle | undefined;

    try {
      handle =
        await fs.open(
          fullPath,
          "r"
        );

      const information =
        await handle.stat();

      const pathInformation =
        await fs.lstat(
          fullPath
        );

      if (
        !information.isFile() ||
        pathInformation.isSymbolicLink() ||
        !pathInformation.isFile() ||
        !sameFileIdentity(
          information,
          pathInformation
        )
      ) {
        throw new Error(
          `Owned package path is not a regular file: ${relativePath}`
        );
      }

      const content =
        await handle.readFile();

      const completedInformation =
        await handle.stat();

      if (
        fileChangedWhileReading(
          information,
          completedInformation
        )
      ) {
        throw new Error(
          `Owned package file changed while its digest was being recorded: ${relativePath}`
        );
      }

      return createHash(
        "sha256"
      )
        .update(content)
        .digest("hex");
    }
    catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        handle === undefined &&
        allowMissing &&
        code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
    finally {
      await handle?.close();
    }
  }
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function fileChangedWhileReading(
  before: Stats,
  after: Stats
): boolean {
  return (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  );
}

function compareText(
  left: string,
  right: string
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}