import type { AuroraPlugin } from "./plugin.js";

const plugins =
  new Map<
    string,
    AuroraPlugin
  >();

export function registerPlugin(
  plugin: AuroraPlugin
): void {

  plugins.set(
    plugin.id,
    plugin
  );

}

export function getPlugin(
  id: string
): AuroraPlugin {

  const plugin =
    plugins.get(id);

  if (!plugin) {

    throw new Error(
      `Plugin '${id}' not found.`
    );

  }

  return plugin;

}

export function getPlugins(): AuroraPlugin[] {

  return [
    ...plugins.values()
  ];

}