import {
  pathToFileURL,
} from "node:url";

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
  getDefaultPackageRoot,
} from "../packagePaths.js";

import type {
  InstallerContext,
} from "./installerContext.js";

export type PackageInstallerFunction =
  (
    context: InstallerContext
  ) => Promise<void>;

export async function loadInstaller(
  manifest: PackageManifest,
  packageRoot = getDefaultPackageRoot()
): Promise<
  PackageInstallerFunction | null
> {
  const declaration =
    manifest.files.find(
      (file) =>
        file.role === "installer"
    );

  if (!declaration) {
    return null;
  }

  const installerPath =
    new ProjectPathBoundary(
      packageRoot
    ).resolve(
      `${manifest.id}/${declaration.path}`
    );

  console.log("");
  console.log(
    `Loading installer:` +
    `\n${installerPath}`
  );

  let module:
    Record<string, unknown>;

  try {
    module = await import(
      pathToFileURL(installerPath).href
    ) as Record<string, unknown>;
  } catch (error) {
    throw new AuroraError(
      `Declared installer '${declaration.path}' for package '${manifest.id}' could not be loaded.`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Repair the verified package artifact before retrying installation.",
        cause: error,
      }
    );
  }

  if (
    typeof module.install !==
    "function"
  ) {
    throw new AuroraError(
      `Declared installer '${declaration.path}' for package '${manifest.id}' does not export an install function.`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Export an async install(context) function from the declared installer.",
      }
    );
  }

  return module.install as
    PackageInstallerFunction;
}
