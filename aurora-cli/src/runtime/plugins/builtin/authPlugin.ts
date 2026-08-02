import type {
  AuroraPlugin
} from "../plugin.js";

export const authPlugin: AuroraPlugin = {

  id: "auth",

  name: "Authentication",

  version: "1.0.0",

  async activate() {

    console.log(
      "✔ Authentication plugin activated."
    );

  },

  async deactivate() {

    console.log(
      "Authentication plugin stopped."
    );

  }

};