export interface AuroraPlugin {
  id: string;
  name: string;
  version: string;

  initialize(): Promise<void>;
}

const plugins: AuroraPlugin[] = [];

export function registerPlugin(
  plugin: AuroraPlugin
): void {
  plugins.push(plugin);
}

export function getPlugins(): AuroraPlugin[] {
  return plugins;
}