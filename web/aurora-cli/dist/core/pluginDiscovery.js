import path from "path";
import { readDirectory } from "./filesystem.js";
export async function discoverPlugins() {
    const pluginDirectory = path.join(process.cwd(), "src", "plugins");
    return await readDirectory(pluginDirectory);
}
//# sourceMappingURL=pluginDiscovery.js.map