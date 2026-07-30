import path from "path";
import { discoverFiles } from "./discoveryService.js";
import { loadModules } from "./moduleLoader.js";
export async function discoverPlugins() {
    const directory = path.resolve(process.cwd(), "src/plugins");
    const plugins = await discoverFiles(directory);
    await loadModules(plugins);
}
//# sourceMappingURL=pluginDiscovery.js.map