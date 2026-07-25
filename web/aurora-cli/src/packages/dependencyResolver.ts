import path from "path";

import { loadManifest } from "./manifestLoader.js";

export async function resolveDependencies(
  packageId: string,
  resolved = new Set<string>()
): Promise<string[]> {

  if (resolved.has(packageId)) {

    return [];

  }

  resolved.add(packageId);

  const manifest =
    await loadManifest(

      path.join(
        process.cwd(),
        "packages",
        packageId,
        "manifest.json"
      )

    );

  const result: string[] = [];

  for (const dependency of manifest.dependencies) {

    result.push(

      ...(await resolveDependencies(
        dependency,
        resolved
      ))

    );

  }

  result.push(packageId);

  return result;

}