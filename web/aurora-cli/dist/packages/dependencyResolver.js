import path from "path";
import { loadManifest } from "./manifestLoader.js";
export async function resolveDependencies(packageId, resolved = new Set()) {
    if (resolved.has(packageId)) {
        return [];
    }
    resolved.add(packageId);
    const manifest = await loadManifest(path.join(process.cwd(), "packages", packageId, "manifest.json"));
    const result = [];
    for (const dependency of manifest.dependencies) {
        result.push(...(await resolveDependencies(dependency, resolved)));
    }
    result.push(packageId);
    return result;
}
//# sourceMappingURL=dependencyResolver.js.map