import type {
  AuroraPlugin,
} from "../plugin.js";

import {
  authPluginMetadata,
} from "./authPluginMetadata.js";

export const authPlugin:
  AuroraPlugin = {
    ...authPluginMetadata,

    async activate() {
      console.log(
        "✔ Authentication plugin activated."
      );
    },

    async deactivate() {
      console.log(
        "Authentication plugin stopped."
      );
    },
  };
