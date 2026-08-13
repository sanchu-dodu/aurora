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

type PackageHook =
  (
    context: InstallerContext
  ) => Promise<void>;

export interface PackageHooks {
  readonly beforeInstall?:
    PackageHook;

  readonly afterInstall?:
    PackageHook;
}

export async function loadHooks(
  manifest: PackageManifest,
  packageRoot = getDefaultPackageRoot()
): Promise<PackageHooks | null> {
  const declaration =
    manifest.files.find(
      (file) =>
        file.role === "hook"
    );

  if (!declaration) {
    return null;
  }

  const hookPath =
    new ProjectPathBoundary(
      packageRoot
    ).resolve(
      `${manifest.id}/${declaration.path}`
    );

  let module:
    Record<string, unknown>;

  try {
    module = await import(
      pathToFileURL(hookPath).href
    ) as Record<string, unknown>;
  } catch (error) {
    throw new AuroraError(
      `Declared hook '${declaration.path}' for package '${manifest.id}' could not be loaded.`,
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

  for (const exportName of [
    "beforeInstall",
    "afterInstall",
  ] as const) {
    const hook = module[exportName];

    if (
      hook !== undefined &&
      typeof hook !== "function"
    ) {
      throw new AuroraError(
        `Declared hook '${declaration.path}' exports non-function '${exportName}'.`,
        {
          code:
            ErrorCodes
              .INVALID_PACKAGE_MANIFEST,
          suggestion:
            "Package lifecycle hook exports must be async functions.",
        }
      );
    }
  }

  return {
    beforeInstall:
      module.beforeInstall as
        PackageHook | undefined,
    afterInstall:
      module.afterInstall as
        PackageHook | undefined,
  };
}
