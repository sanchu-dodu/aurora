import type { AuroraPlugin } from "./pluginRegistry.js";
export declare function getLoadedPlugins(): AuroraPlugin[];
export declare function initializePlugins(): Promise<void>;
