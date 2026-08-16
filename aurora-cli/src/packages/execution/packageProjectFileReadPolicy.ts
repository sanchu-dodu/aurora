import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

const PROTECTED_FILE_NAMES =
  new Set([
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".netrc",
    "_netrc",
    ".pypirc",
  ]);

const PROTECTED_DIRECTORY_NAMES =
  new Set([
    ".git",
    ".aurora",
  ]);

export function assertPackageProjectFileRead(
  packageId: string,
  relativePath: string
): void {
  const normalizedSegments =
    relativePath
      .split(/[\\/]+/u)
      .filter(
        segment =>
          segment.length > 0 &&
          segment !== "."
      )
      .map(
        segment =>
          segment.toLowerCase()
      );

  if (
    normalizedSegments.some(
      segment =>
        PROTECTED_DIRECTORY_NAMES
          .has(segment)
    )
  ) {
    deny(
      packageId,
      relativePath
    );
  }

  const basename =
    normalizedSegments[
      normalizedSegments.length - 1
    ] ?? "";

  if (
    basename === ".env" ||
    basename.startsWith(
      ".env."
    ) ||
    PROTECTED_FILE_NAMES.has(
      basename
    )
  ) {
    deny(
      packageId,
      relativePath
    );
  }
}

function deny(
  packageId: string,
  relativePath: string
): never {
  throw new AuroraError(
    `Package '${packageId}' project file read from '${relativePath}' targets a protected read-sensitive project surface.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PERMISSION_DENIED,
      suggestion:
        "Project packages cannot read credential files, environment files, VCS internals, or Aurora-internal project state.",
    }
  );
}
