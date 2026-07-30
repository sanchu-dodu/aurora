import { getPlugins } from "./pluginRegistry.js";
import { discoverPlugins } from "./pluginDiscovery.js";
import { logger } from "./logger.js";
const loadedPlugins = [];
export function getLoadedPlugins() {
    return loadedPlugins;
}
export async function initializePlugins() {
    const discovered = await discoverPlugins();
    logger.info(`Discovered ${discovered.length} plugin file(s).`);
    const plugins = getPlugins();
    loadedPlugins.length = 0;
    for (const plugin of plugins) {
        logger.success(`Loading plugin: ${plugin.name}`);
        await plugin.initialize();
        loadedPlugins.push(plugin);
    }
}
//# sourceMappingURL=pluginLoader.js.map