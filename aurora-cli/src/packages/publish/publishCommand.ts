import path from "node:path";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  isCanonicalPackageIdentifier,
} from "../manifestSchema.js";

import { PackagePublisher } from "./packagePublisher.js";

export interface PublishPackageOptions {
  readonly dryRun?: boolean;
}

export async function publishPackage(
  packageId: string,
  options:
    PublishPackageOptions = {}
): Promise<void> {

  if (
    packageId.length > 128 ||
    !isCanonicalPackageIdentifier(
      packageId
    )
  ) {
    throw new AuroraError(
      `Package id '${packageId}' is not canonical.`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Use a lowercase package id containing only letters, numbers, dots, or hyphens.",
      }
    );
  }

  const workspaceRoot =
    process.cwd();

  const publisher =
    new PackagePublisher({
      workspaceRoot,
    });

  const packagePath =
    path.join(
      workspaceRoot,
      "packages",
      packageId
    );

  if (options.dryRun) {
    await publisher.prepare(
      packagePath
    );
    return;
  }

  await publisher.publish(
    packagePath
  );

}
