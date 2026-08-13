import {
  CacheManager,
} from "../cache/cacheManager.js";

import {
  PackageRegistry,
} from "../registry/registry.js";

export async function showPackageInfo(
  packageId: string
): Promise<void> {
  const registry =
    new PackageRegistry();

  const manifest =
    await registry.getPackage(
      packageId
    );

  const cache =
    new CacheManager(
      process.cwd()
    );

  const installed =
    await cache.read();

  const record =
    installed[packageId];

  console.log();
  console.log(
    "Package Information"
  );
  console.log(
    "==================="
  );
  console.log();

  console.log(
    `Name: ${manifest.name}`
  );
  console.log(
    `ID: ${manifest.id}`
  );
  console.log(
    `Version: ${manifest.version}`
  );
  console.log(
    `Description: ${manifest.description}`
  );
  console.log();

  console.log(
    `Installed: ${record ? "Yes" : "No"}`
  );

  if (record?.checksum) {
    console.log(
      `Checksum: ${record.checksum}`
    );
  }

  console.log();
  console.log("Dependencies");
  console.log("------------");

  if (
    manifest.dependencies.length > 0
  ) {
    for (const dependency of manifest.dependencies) {
      console.log(
        `${dependency.id} ${dependency.version}` +
        `${dependency.optional ? " (optional)" : ""}`
      );
    }
  } else {
    console.log("None");
  }

  console.log();
}
