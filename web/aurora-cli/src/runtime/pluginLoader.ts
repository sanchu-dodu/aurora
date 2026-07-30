import { PluginHost } from "./pluginHost.js";
import { authPlugin } from "./plugins/builtin/authPlugin.js";
import type {
  AuroraPlugin
} from "./plugins/plugin.js";

export class PluginLoader {

  private host =
    new PluginHost();

  load(): void {

  this.host.register(
    authPlugin
  );

}

}