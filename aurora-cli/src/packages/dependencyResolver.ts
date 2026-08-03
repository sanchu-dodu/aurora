import path from "node:path";

import { loadManifest } from "./manifestLoader.js";
import { getDefaultPackageRoot } from "./packagePaths.js";

export async function resolveDependencies(
  packageId: string,
  packageRoot = getDefaultPackageRoot(),
  resolved = new Set<string>()
): Promise<string[]> {
  if (resolved.has(packageId)) {
    return [];
  }

  resolved.add(packageId);

  const manifest = await loadManifest(
    path.join(
      packageRoot,
      packageId,
      "manifest.json"
    )
  );

  const result: string[] = [];

  for (const dependency of manifest.dependencies ?? []) {
    result.push(
      ...(
        await resolveDependencies(
          dependency,
          packageRoot,
          resolved
        )
      )
    );
  }

  result.push(packageId);

  return result;
}
