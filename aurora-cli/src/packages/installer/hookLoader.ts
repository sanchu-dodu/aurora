import path from "node:path";
import { pathToFileURL } from "node:url";

import { getDefaultPackageRoot } from "../packagePaths.js";

export async function loadHooks(
  packageId: string,
  packageRoot = getDefaultPackageRoot()
) {
  const hookPath = path.join(
    packageRoot,
    packageId,
    "hooks",
    "hooks.js"
  );

  try {
    return await import(
      pathToFileURL(hookPath).href
    );
  } catch {
    return null;
  }
}
