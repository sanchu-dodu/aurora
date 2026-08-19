import {
  createHash,
} from "node:crypto";

import type {
  Stats,
} from "node:fs";

import fs from "node:fs/promises";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  CacheManager,
} from "../cache/cacheManager.js";

import {
  LockManager,
} from "../lock/lockManager.js";

import {
  parsePackageStateReceipt,
} from "../state/packageStateSchema.js";

import type {
  PackageOwnedDependency,
  PackageOwnedEnvironment,
  PackageStateReceipt,
} from "../state/packageStateSchema.js";

import {
  PackageStateStore,
} from "../state/packageStateStore.js";

type JsonObject =
  Record<string, unknown>;

export class InstalledStateVerifier {
  async verify(
    packageId: string,
    projectPath: string
  ): Promise<void> {
    try {
      const pathBoundary =
        new ProjectPathBoundary(
          projectPath
        );

      const stateStore =
        new PackageStateStore(
          projectPath
        );

      const receipt =
        await stateStore.getReceipt(
          packageId
        );

      if (!receipt) {
        throw integrityFailure(
          packageId,
          "No installed-state ownership receipt exists for this package."
        );
      }

      const cache =
        await new CacheManager(
          projectPath
        ).readExisting();

      const cached =
        cache[packageId];

      if (!cached) {
        throw integrityFailure(
          packageId,
          "The package is missing from the installed-package cache."
        );
      }

      if (
        cached.version !==
        receipt.version
      ) {
        throw integrityFailure(
          packageId,
          `Installed cache version '${cached.version}' does not match ownership receipt version '${receipt.version}'.`
        );
      }

      const lockFile =
        await new LockManager(
          projectPath
        ).read();

      const lockedVersion =
        lockFile.packages[
          packageId
        ];

      if (
        lockedVersion ===
        undefined
      ) {
        throw integrityFailure(
          packageId,
          "The package is missing from aurora.lock."
        );
      }

      if (
        lockedVersion !==
        receipt.version
      ) {
        throw integrityFailure(
          packageId,
          `Locked version '${lockedVersion}' does not match ownership receipt version '${receipt.version}'.`
        );
      }

      for (
        const ownedFile
        of receipt.files
      ) {
        const digest =
          await this
            .readStableDigest(
              pathBoundary,
              ownedFile.path,
              true
            );

        if (digest === null) {
          throw integrityFailure(
            packageId,
            `Owned file '${ownedFile.path}' is missing.`
          );
        }

        if (
          digest !==
          ownedFile.sha256
        ) {
          throw integrityFailure(
            packageId,
            `Owned file '${ownedFile.path}' does not match its recorded installed digest.`
          );
        }
      }

      await this
        .verifyDependencies(
          packageId,
          pathBoundary,
          receipt.dependencies
        );

      await this
        .verifyEnvironment(
          packageId,
          pathBoundary,
          receipt.environment
        );
    }
    catch (error) {
      if (
        error instanceof
          AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
      ) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw integrityFailure(
        packageId,
        message,
        error
      );
    }
  }

  private async verifyDependencies(
    packageId: string,
    pathBoundary:
      ProjectPathBoundary,
    dependencies:
      readonly PackageOwnedDependency[]
  ): Promise<void> {
    if (
      dependencies.length === 0
    ) {
      return;
    }

    const content =
      await this
        .readStableRegularFile(
          pathBoundary,
          "package.json",
          false
        );

    if (content === null) {
      throw integrityFailure(
        packageId,
        "Project package.json is missing."
      );
    }

    const decoded =
      JSON.parse(
        content.toString(
          "utf8"
        )
      ) as unknown;

    const packageJson =
      asJsonObject(
        decoded
      );

    if (!packageJson) {
      throw integrityFailure(
        packageId,
        "Project package.json must contain a JSON object."
      );
    }

    let currentDependencies:
      JsonObject = {};

    if (
      packageJson.dependencies !==
      undefined
    ) {
      const parsedDependencies =
        asJsonObject(
          packageJson.dependencies
        );

      if (!parsedDependencies) {
        throw integrityFailure(
          packageId,
          "Project package.json dependencies must be a JSON object."
        );
      }

      currentDependencies =
        parsedDependencies;
    }

    for (
      const dependency
      of dependencies
    ) {
      const currentVersion =
        currentDependencies[
          dependency.name
        ];

      if (
        typeof currentVersion !==
        "string"
      ) {
        throw integrityFailure(
          packageId,
          `Owned dependency '${dependency.name}' is missing from package.json dependencies.`
        );
      }

      if (
        currentVersion !==
        dependency.version
      ) {
        throw integrityFailure(
          packageId,
          `Owned dependency '${dependency.name}' has version '${currentVersion}' instead of recorded installed version '${dependency.version}'.`
        );
      }
    }
  }

  private async verifyEnvironment(
    packageId: string,
    pathBoundary:
      ProjectPathBoundary,
    environment:
      readonly PackageOwnedEnvironment[]
  ): Promise<void> {
    const introduced =
      environment.filter(
        variable =>
          variable.introduced
      );

    if (
      introduced.length === 0
    ) {
      return;
    }

    const content =
      await this
        .readStableRegularFile(
          pathBoundary,
          ".env.example",
          true
        );

    if (content === null) {
      throw integrityFailure(
        packageId,
        "Package-introduced environment variables are recorded but .env.example is missing."
      );
    }

    const lines =
      content
        .toString("utf8")
        .split(/\r?\n/u);

    for (
      const variable
      of introduced
    ) {
      const marker =
        `${variable.name}=`;

      const present =
        lines.some(
          line =>
            line.startsWith(
              marker
            )
        );

      if (!present) {
        throw integrityFailure(
          packageId,
          `Package-introduced environment variable '${variable.name}' is missing from .env.example.`
        );
      }
    }
  }

  /**
   * Verify an explicitly supplied ownership receipt
   * without reading PackageStateStore.
   *
   * This entry point is for callers that already
   * hold the process-wide lifecycle WriteLock.
   * PackageStateStore.read()/getReceipt() acquire
   * that same non-reentrant lock, so invoking the
   * normal verify() method while the lock is held
   * would deadlock.
   *
   * The supplied receipt is independently schema
   * validated before any verification is trusted.
   */
  async verifyReceipt(
    packageId: string,
    projectPath: string,
    receiptInput:
      PackageStateReceipt
  ): Promise<void> {
    try {
      const receipt =
        parsePackageStateReceipt(
          receiptInput
        );

      if (
        receipt.id !==
          packageId
      ) {
        throw integrityFailure(
          packageId,
          `Supplied ownership receipt belongs to package '${receipt.id}'.`
        );
      }

      const pathBoundary =
        new ProjectPathBoundary(
          projectPath
        );

      const cache =
        await new CacheManager(
          projectPath
        ).readExisting();

      const cached =
        cache[
          packageId
        ];

      if (!cached) {
        throw integrityFailure(
          packageId,
          "The package is missing from the installed-package cache."
        );
      }

      if (
        cached.version !==
          receipt.version
      ) {
        throw integrityFailure(
          packageId,
          `Installed cache version '${cached.version}' does not match ownership receipt version '${receipt.version}'.`
        );
      }

      const lockFile =
        await new LockManager(
          projectPath
        ).read();

      const lockedVersion =
        lockFile.packages[
          packageId
        ];

      if (
        lockedVersion ===
          undefined
      ) {
        throw integrityFailure(
          packageId,
          "The package is missing from aurora.lock."
        );
      }

      if (
        lockedVersion !==
          receipt.version
      ) {
        throw integrityFailure(
          packageId,
          `Locked version '${lockedVersion}' does not match ownership receipt version '${receipt.version}'.`
        );
      }

      for (
        const ownedFile
        of receipt.files
      ) {
        const digest =
          await this
            .readStableDigest(
              pathBoundary,
              ownedFile.path,
              true
            );

        if (
          digest ===
            null
        ) {
          throw integrityFailure(
            packageId,
            `Owned file '${ownedFile.path}' is missing.`
          );
        }

        if (
          digest !==
            ownedFile.sha256
        ) {
          throw integrityFailure(
            packageId,
            `Owned file '${ownedFile.path}' does not match its recorded installed digest.`
          );
        }
      }

      await this
        .verifyDependencies(
          packageId,
          pathBoundary,
          receipt.dependencies
        );

      await this
        .verifyEnvironment(
          packageId,
          pathBoundary,
          receipt.environment
        );
    }
    catch (error) {
      if (
        error instanceof
          AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
      ) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw integrityFailure(
        packageId,
        message,
        error
      );
    }
  }

  private async readStableDigest(
    pathBoundary:
      ProjectPathBoundary,
    relativePath: string,
    allowMissing: boolean
  ): Promise<string | null> {
    const content =
      await this
        .readStableRegularFile(
          pathBoundary,
          relativePath,
          allowMissing
        );

    if (content === null) {
      return null;
    }

    return createHash(
      "sha256"
    )
      .update(content)
      .digest("hex");
  }

  private async readStableRegularFile(
    pathBoundary:
      ProjectPathBoundary,
    relativePath: string,
    allowMissing: boolean
  ): Promise<Buffer | null> {
    const fullPath =
      pathBoundary.resolve(
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
        pathInformation
          .isSymbolicLink() ||
        !pathInformation
          .isFile() ||
        !sameFileIdentity(
          information,
          pathInformation
        )
      ) {
        throw new Error(
          `Installed-state path is not a stable regular file: ${relativePath}`
        );
      }

      const content =
        await handle.readFile();

      const completedInformation =
        await handle.stat();

      if (
        !sameFileIdentity(
          information,
          completedInformation
        ) ||
        fileChangedWhileReading(
          information,
          completedInformation
        )
      ) {
        throw new Error(
          `Installed-state file changed while it was being verified: ${relativePath}`
        );
      }

      const completedPathInformation =
        await fs.lstat(
          fullPath
        );

      if (
        completedPathInformation
          .isSymbolicLink() ||
        !completedPathInformation
          .isFile() ||
        !sameFileIdentity(
          completedInformation,
          completedPathInformation
        )
      ) {
        throw new Error(
          `Installed-state path changed while it was being verified: ${relativePath}`
        );
      }

      return content;
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

function asJsonObject(
  value: unknown
): JsonObject | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  return value as
    JsonObject;
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
    before.mtimeMs !==
      after.mtimeMs ||
    before.ctimeMs !==
      after.ctimeMs
  );
}

function integrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' failed installed-state verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,

      suggestion:
        "Restore the package-owned project state from a trusted source or reinstall the package, then run package verification again.",

      cause,
    }
  );
}
