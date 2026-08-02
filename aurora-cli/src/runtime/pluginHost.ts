import {
  registerPlugin
} from "./plugins/pluginRegistry.js";

import type {
  AuroraPlugin
} from "./plugins/plugin.js";

export class PluginHost {

  register(
    plugin: AuroraPlugin
  ): void {

    registerPlugin(
      plugin
    );

  }

}