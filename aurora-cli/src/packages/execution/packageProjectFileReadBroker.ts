import type {
  BigIntStats,
} from "node:fs";

import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";

import type {
  FileHandle,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  TextDecoder,
} from "node:util";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  assertPackageProjectFileRead,
} from "./packageProjectFileReadPolicy.js";

export const PACKAGE_PROJECT_FILE_MAX_BYTES =
  256 * 1024;

export type PackageProjectFileManifest =
  Readonly<
    Pick<
      PackageManifest,
      | "id"
      | "publisher"
      | "capabilities"
      | "projectFileReads"
    >
  >;

export interface PackageProjectFileAccessPolicy {
  assertProjectFileReadAccess(
    manifest: PackageProjectFileManifest,
    relativePath: string
  ): void;
}

export interface PackageProjectFileReader {
  readProjectFileText(
    manifest: PackageProjectFileManifest,
    relativePath: string
  ): Promise<string | null>;
}

export interface PackageProjectFileReadBrokerOptions {
  readonly projectRoot: string;
  readonly accessPolicy:
    PackageProjectFileAccessPolicy;
}

export class PackageProjectFileReadBroker
implements PackageProjectFileReader {
  private readonly boundary:
    ProjectPathBoundary;

  private readonly accessPolicy:
    PackageProjectFileAccessPolicy;

  constructor(
    options:
      PackageProjectFileReadBrokerOptions
  ) {
    this.boundary =
      new ProjectPathBoundary(
        options.projectRoot
      );

    this.accessPolicy =
      options.accessPolicy;
  }

  async readProjectFileText(
    manifest:
      PackageProjectFileManifest,
    relativePath: string
  ): Promise<string | null> {
    /*
     * Authorization happens before any target-path
     * resolution or filesystem access.
     */
    this.accessPolicy
      .assertProjectFileReadAccess(
        manifest,
        relativePath
      );

    const declaration =
      assertDeclaredProjectFile(
        manifest,
        relativePath
      );

    assertPackageProjectFileRead(
      manifest.id,
      relativePath
    );

    const candidate =
      this.boundary.resolve(
        relativePath
      );

    let handle: FileHandle;

    try {
      handle =
        await open(
          candidate,
          "r"
        );
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        await assertMissingProjectPathIsSafe(
          this.boundary,
          candidate,
          manifest.id,
          relativePath
        );

        if (declaration.required) {
          throw requiredProjectFileError(
            manifest.id,
            relativePath
          );
        }

        return null;
      }

      throw projectFileFailure(
        manifest.id,
        relativePath,
        "could not be opened safely",
        error
      );
    }

    try {
      const openedInformation =
        await handle.stat({
          bigint: true,
        });

      if (!openedInformation.isFile()) {
        throw invalidProjectFileError(
          manifest.id,
          relativePath,
          "is not a regular file"
        );
      }

      await assertOpenedPathStillMatches(
        this.boundary,
        relativePath,
        candidate,
        openedInformation,
        manifest.id
      );

      if (
        openedInformation.size >
        BigInt(
          PACKAGE_PROJECT_FILE_MAX_BYTES
        )
      ) {
        throw projectFileReadLimitError(
          manifest.id,
          relativePath
        );
      }

      return await readBoundedText(
        handle,
        manifest.id,
        relativePath
      );
    } catch (error) {
      if (error instanceof AuroraError) {
        throw error;
      }

      throw projectFileFailure(
        manifest.id,
        relativePath,
        "could not be read safely",
        error
      );
    } finally {
      await handle.close();
    }
  }
}

function assertDeclaredProjectFile(
  manifest: PackageProjectFileManifest,
  relativePath: string
): Readonly<{
  path: string;
  required: boolean;
}> {
  const declaration =
    (manifest.projectFileReads ?? [])
      .find(
        candidate =>
          candidate.path ===
          relativePath
      );

  if (!declaration) {
    throw new AuroraError(
      `Package '${manifest.id}' cannot read undeclared project file '${relativePath}'.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Declare and grant only the exact canonical project file paths required by the package.",
      }
    );
  }

  return declaration;
}

async function assertMissingProjectPathIsSafe(
  boundary: ProjectPathBoundary,
  candidate: string,
  packageId: string,
  relativePath: string
): Promise<void> {
  /*
   * ENOENT is not sufficient to prove an optional
   * project file is genuinely absent. On some
   * platforms a child beneath a regular file also
   * surfaces as ENOENT.
   *
   * Recheck the target, then walk toward the project
   * root until the nearest existing ancestor is found.
   */
  try {
    const targetInformation =
      await lstat(
        candidate,
        {
          bigint: true,
        }
      );

    if (targetInformation.isSymbolicLink()) {
      throw unsafeOpenedPathError(
        relativePath,
        "became a symbolic link or junction while resolving a missing file"
      );
    }

    throw unsafeOpenedPathError(
      relativePath,
      "appeared while resolving a missing file"
    );
  } catch (error) {
    if (error instanceof AuroraError) {
      throw error;
    }

    if (!isErrno(error, "ENOENT")) {
      throw projectFileFailure(
        packageId,
        relativePath,
        "could not confirm that the target is genuinely absent",
        error
      );
    }
  }

  let current =
    dirname(candidate);

  while (current !== boundary.projectRoot) {
    let information: BigIntStats;

    try {
      information =
        await lstat(
          current,
          {
            bigint: true,
          }
        );
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        const parent =
          dirname(current);

        if (parent === current) {
          throw unsafeOpenedPathError(
            relativePath,
            "could not establish a safe missing-path ancestor"
          );
        }

        current = parent;
        continue;
      }

      throw projectFileFailure(
        packageId,
        relativePath,
        "could not validate missing-path ancestry",
        error
      );
    }

    if (information.isSymbolicLink()) {
      throw unsafeOpenedPathError(
        relativePath,
        "passes through a symbolic link or junction while resolving a missing file"
      );
    }

    if (!information.isDirectory()) {
      throw unsafeOpenedPathError(
        relativePath,
        "passes through a non-directory ancestor"
      );
    }

    let canonicalAncestor: string;

    try {
      canonicalAncestor =
        await realpath(current);
    } catch (error) {
      throw projectFileFailure(
        packageId,
        relativePath,
        "could not canonicalize missing-path ancestry",
        error
      );
    }

    boundary.validateAbsolutePath(
      canonicalAncestor
    );

    return;
  }
}

async function assertOpenedPathStillMatches(
  boundary: ProjectPathBoundary,
  relativePath: string,
  candidate: string,
  openedInformation: BigIntStats,
  packageId: string
): Promise<void> {
  /*
   * The opened handle is authoritative for the read.
   * Re-resolve after open, then compare the current
   * path identity with the opened handle. This detects
   * replacement between the boundary check and open.
   */
  const postOpenCandidate =
    boundary.resolve(
      relativePath
    );

  if (postOpenCandidate !== candidate) {
    throw unsafeOpenedPathError(
      relativePath,
      "resolved to a different path after opening"
    );
  }

  let pathInformation: BigIntStats;
  let canonicalPath: string;

  try {
    pathInformation =
      await lstat(
        postOpenCandidate,
        {
          bigint: true,
        }
      );

    if (pathInformation.isSymbolicLink()) {
      throw unsafeOpenedPathError(
        relativePath,
        "became a symbolic link or junction during secure open"
      );
    }

    canonicalPath =
      await realpath(
        postOpenCandidate
      );
  } catch (error) {
    if (error instanceof AuroraError) {
      throw error;
    }

    throw projectFileFailure(
      packageId,
      relativePath,
      "could not be revalidated after opening",
      error
    );
  }

  boundary.validateAbsolutePath(
    canonicalPath
  );

  if (
    openedInformation.dev !==
      pathInformation.dev ||
    openedInformation.ino !==
      pathInformation.ino
  ) {
    throw unsafeOpenedPathError(
      relativePath,
      "changed identity during secure open"
    );
  }
}

async function readBoundedText(
  handle: FileHandle,
  packageId: string,
  relativePath: string
): Promise<string> {
  const buffer =
    Buffer.alloc(
      PACKAGE_PROJECT_FILE_MAX_BYTES + 1
    );

  let totalBytes = 0;

  while (totalBytes < buffer.length) {
    const { bytesRead } =
      await handle.read(
        buffer,
        totalBytes,
        buffer.length - totalBytes,
        totalBytes
      );

    if (bytesRead === 0) {
      break;
    }

    totalBytes += bytesRead;
  }

  if (
    totalBytes >
    PACKAGE_PROJECT_FILE_MAX_BYTES
  ) {
    throw projectFileReadLimitError(
      packageId,
      relativePath
    );
  }

  let text: string;

  try {
    text =
      new TextDecoder(
        "utf-8",
        { fatal: true }
      ).decode(
        buffer.subarray(
          0,
          totalBytes
        )
      );
  } catch (error) {
    throw invalidProjectFileError(
      packageId,
      relativePath,
      "is not valid UTF-8 text",
      error
    );
  }

  if (text.includes("\0")) {
    throw invalidProjectFileError(
      packageId,
      relativePath,
      "contains a NUL character"
    );
  }

  return text;
}

function requiredProjectFileError(
  packageId: string,
  relativePath: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' requires project file '${relativePath}', but the file is not available.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PROJECT_FILE_REQUIRED,
      suggestion:
        "Provide the required project file or install the package only in projects that contain it.",
    }
  );
}

function projectFileReadLimitError(
  packageId: string,
  relativePath: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' project file '${relativePath}' exceeds the ${PACKAGE_PROJECT_FILE_MAX_BYTES} byte read limit.`,
    {
      code:
        ErrorCodes
          .PACKAGE_READ_LIMIT,
      suggestion:
        "Read only small explicitly declared project text files through the package project-file broker.",
    }
  );
}

function invalidProjectFileError(
  packageId: string,
  relativePath: string,
  reason: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' project file '${relativePath}' ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_EXECUTION_FAILED,
      suggestion:
        "Project-file reads must target regular UTF-8 text files without NUL characters.",
      cause,
    }
  );
}

function unsafeOpenedPathError(
  relativePath: string,
  reason: string
): AuroraError {
  return new AuroraError(
    `Project file '${relativePath}' ${reason}.`,
    {
      code:
        ErrorCodes
          .UNSAFE_PROJECT_PATH,
      suggestion:
        "Use a stable regular file that remains inside the project root throughout the brokered read.",
    }
  );
}

function projectFileFailure(
  packageId: string,
  relativePath: string,
  reason: string,
  cause: unknown
): AuroraError {
  return new AuroraError(
    `Project-file broker for package '${packageId}' path '${relativePath}' ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_EXECUTION_FAILED,
      suggestion:
        "Verify that the declared project file is a stable regular file inside the project root.",
      cause,
    }
  );
}

function isErrno(
  error: unknown,
  code: string
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException)
      .code === code
  );
}
