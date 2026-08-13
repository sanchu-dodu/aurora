import manifest from "../../plugins/helloExtension.manifest.json" with { type: "json" };

import {
  validateExtensionManifest,
} from "../extensions/extensionManifest.js";

import {
  authPluginMetadata,
} from "./builtin/authPluginMetadata.js";

export interface PluginDescriptor {
  readonly id: string;

  readonly name: string;

  readonly version: string;
}

const helloExtension =
  validateExtensionManifest(
    manifest,
    "built-in hello extension manifest"
  );

const plugins:
  readonly PluginDescriptor[] = [
    authPluginMetadata,
    {
      id: helloExtension.id,
      name: helloExtension.name,
      version:
        helloExtension.version,
    },
  ];

export function getPluginCatalog():
  readonly PluginDescriptor[] {
  return plugins;
}