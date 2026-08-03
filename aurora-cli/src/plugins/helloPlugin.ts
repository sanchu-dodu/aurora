import {
  registerPlugin,
} from "../runtime/plugins/pluginRegistry.js";

registerPlugin({
  id: "hello",

  name: "Hello Plugin",

  version: "1.0.0",

  async activate() {
    console.log(
      "✔ Hello Plugin activated."
    );
  },

  async deactivate() {
    console.log(
      "Hello Plugin stopped."
    );
  },
});
