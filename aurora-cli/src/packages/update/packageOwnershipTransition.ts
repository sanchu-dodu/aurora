import type {
  PackageOwnedDependency,
  PackageOwnedEnvironment,
  PackageOwnedFile,
  PackageStateReceipt,
} from "../state/packageStateSchema.js";

import {
  parsePackageStateReceipt,
} from "../state/packageStateSchema.js";


export function mergePackageOwnershipReceipts(
  previous:
    PackageStateReceipt,
  next:
    PackageStateReceipt
): PackageStateReceipt {
  if (
    previous.id !==
      next.id
  ) {
    throw new Error(
      `Cannot merge ownership receipts for different packages '${previous.id}' and '${next.id}'.`
    );
  }

  if (
    previous.publisherId !==
      next.publisherId
  ) {
    throw new Error(
      `Package '${previous.id}' changed publisher from '${previous.publisherId}' to '${next.publisherId}' during update.`
    );
  }

  return parsePackageStateReceipt({
    ...next,

    files:
      mergeFiles(
        previous.files,
        next.files
      ),

    dependencies:
      mergeDependencies(
        previous.dependencies,
        next.dependencies
      ),

    environment:
      mergeEnvironment(
        previous.environment,
        next.environment
      ),
  });
}


function mergeFiles(
  previous:
    readonly PackageOwnedFile[],
  next:
    readonly PackageOwnedFile[]
): PackageOwnedFile[] {
  const merged =
    new Map<
      string,
      PackageOwnedFile
    >();

  for (
    const file
    of previous
  ) {
    merged.set(
      file.path.toLowerCase(),
      {
        ...file,
      }
    );
  }

  for (
    const file
    of next
  ) {
    const key =
      file.path.toLowerCase();

    const historical =
      merged.get(key);

    if (!historical) {
      merged.set(
        key,
        {
          ...file,
        }
      );

      continue;
    }

    /*
     * The first package mutation owns restoration
     * provenance. Later update receipts contribute
     * only the new installed digest.
     */
    merged.set(
      key,
      {
        path:
          file.path,

        action:
          historical.action,

        sha256:
          file.sha256,

        previousSha256:
          historical
            .previousSha256,
      }
    );
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        compareText(
          left.path,
          right.path
        )
    );
}


function mergeDependencies(
  previous:
    readonly PackageOwnedDependency[],
  next:
    readonly PackageOwnedDependency[]
): PackageOwnedDependency[] {
  const merged =
    new Map<
      string,
      PackageOwnedDependency
    >();

  for (
    const dependency
    of previous
  ) {
    merged.set(
      dependency.name
        .toLowerCase(),
      {
        ...dependency,
      }
    );
  }

  for (
    const dependency
    of next
  ) {
    const key =
      dependency.name
        .toLowerCase();

    const historical =
      merged.get(key);

    if (!historical) {
      merged.set(
        key,
        {
          ...dependency,
        }
      );

      continue;
    }

    merged.set(
      key,
      {
        name:
          dependency.name,

        version:
          dependency.version,

        /*
         * Preserve the version that existed before
         * the package first took ownership.
         */
        previousVersion:
          historical
            .previousVersion,
      }
    );
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        compareText(
          left.name,
          right.name
        )
    );
}


function mergeEnvironment(
  previous:
    readonly PackageOwnedEnvironment[],
  next:
    readonly PackageOwnedEnvironment[]
): PackageOwnedEnvironment[] {
  const merged =
    new Map<
      string,
      PackageOwnedEnvironment
    >();

  for (
    const variable
    of previous
  ) {
    merged.set(
      variable.name,
      {
        ...variable,
      }
    );
  }

  for (
    const variable
    of next
  ) {
    const historical =
      merged.get(
        variable.name
      );

    if (!historical) {
      merged.set(
        variable.name,
        {
          ...variable,
        }
      );

      continue;
    }

    /*
     * Environment introduction provenance is
     * cumulative. Once any package version
     * introduced the marker, later updates must
     * never lose that fact.
     */
    merged.set(
      variable.name,
      {
        name:
          variable.name,

        introduced:
          historical.introduced ||
          variable.introduced,
      }
    );
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        compareText(
          left.name,
          right.name
        )
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
