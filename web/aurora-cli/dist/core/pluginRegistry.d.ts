export interface AuroraPlugin {
    id: string;
    name: string;
    version: string;
    initialize(): Promise<void>;
}
export declare function registerPlugin(plugin: AuroraPlugin): void;
export declare function getPlugins(): AuroraPlugin[];
