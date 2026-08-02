import {
  getPlugins
} from "./plugins/pluginRegistry.js";

export class PluginRunner {

  async start(): Promise<void> {

    console.log("");

    console.log(
      "Starting Aurora Runtime..."
    );

    const plugins =
      getPlugins();

    for (const plugin of plugins) {

      console.log(
        `Loading ${plugin.name}...`
      );

      await plugin.activate();

    }

    console.log("");

    console.log(
      `Loaded ${plugins.length} plugin(s).`
    );

  }

}