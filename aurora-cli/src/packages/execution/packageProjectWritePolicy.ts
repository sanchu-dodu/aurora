import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

const PROTECTED_FILE_NAMES =
  new Set([
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "aurora.lock",
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pnpmfile.cjs",
    ".gitlab-ci.yml",
    "azure-pipelines.yml",
    "jenkinsfile",
  ]);

const PROTECTED_DIRECTORY_NAMES =
  new Set([
    ".git",
    ".aurora",
    ".husky",
    ".devcontainer",
    ".circleci",
  ]);

export function assertPackageProjectFileWrite(
  packageId: string,
  relativePath: string
): void {
  const segments =
    relativePath
      .split(/[\\/]+/u)
      .filter(
        segment =>
          segment.length > 0 &&
          segment !== "."
      );

  if (
    segments.length === 0 ||
    segments.includes("..")
  ) {
    deny(
      packageId,
      relativePath
    );
  }

  const normalized =
    segments.map(
      segment =>
        segment.toLowerCase()
    );

  const basename =
    normalized[
      normalized.length - 1
    ];

  if (
    PROTECTED_FILE_NAMES.has(
      basename
    )
  ) {
    deny(
      packageId,
      relativePath
    );
  }

  if (
    basename === ".env" ||
    basename.startsWith(
      ".env."
    )
  ) {
    deny(
      packageId,
      relativePath
    );
  }

  if (
    normalized.some(
      segment =>
        PROTECTED_DIRECTORY_NAMES.has(
          segment
        )
    )
  ) {
    deny(
      packageId,
      relativePath
    );
  }

  for (
    let index = 0;
    index <
      normalized.length - 1;
    index += 1
  ) {
    if (
      normalized[index] ===
        ".github" &&
      normalized[index + 1] ===
        "workflows"
    ) {
      deny(
        packageId,
        relativePath
      );
    }
  }
}

function deny(
  packageId: string,
  relativePath: string
): never {
  throw new AuroraError(
    `Package '${packageId}' file write to '${relativePath}' targets a protected project control surface.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PERMISSION_DENIED,
      suggestion:
        "Use the dedicated brokered capability for dependencies, environment, Aurora metadata, or other protected project control surfaces.",
    }
  );
}
