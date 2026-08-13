import {
  registerPlugin,
} from "../runtime/plugins/pluginRegistry.js";

import {
  ExtensionWorkerHost,
} from "../runtime/extensions/extensionWorkerHost.js";

import manifest from "./helloExtension.manifest.json" with { type: "json" };

import {
  dirname,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

const host =
  new ExtensionWorkerHost();

const extensionRoot =
  dirname(
    fileURLToPath(
      import.meta.url
    )
  );

registerPlugin({
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,

  async activate() {
    await host.run(
      manifest,
      extensionRoot,
      "activate",
      {
        writeOutput(message) {
          console.log(message);
        },
      }
    );
  },

  async deactivate() {
    await host.run(
      manifest,
      extensionRoot,
      "deactivate",
      {
        writeOutput(message) {
          console.log(message);
        },
      }
    );
  },
});
