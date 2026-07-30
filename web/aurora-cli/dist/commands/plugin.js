import { getLoadedPlugins } from "../core/pluginLoader.js";
export async function pluginListCommand() {
    console.log("");
    console.log("Installed Plugins");
    console.log("=================");
    const plugins = getLoadedPlugins();
    if (plugins.length === 0) {
        console.log("No plugins installed.");
        return;
    }
    for (const plugin of plugins) {
        console.log(`✅ ${plugin.name}`);
    }
}
//# sourceMappingURL=plugin.js.map