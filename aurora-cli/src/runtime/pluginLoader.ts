import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PluginHost } from "./pluginHost.js";
import { authPlugin } from "./plugins/builtin/authPlugin.js";
import { getDefaultPluginRoot } from "./pluginPaths.js";

export class PluginLoader {
  constructor(
    private readonly host =
      new PluginHost(),
    private readonly pluginRoot =
      getDefaultPluginRoot()
  ) {}

  async load(): Promise<void> {
    this.host.register(authPlugin);

    const pluginFiles =
      await this.discoverPluginFiles();

    console.log(
      `Discovered ${pluginFiles.length} plugin file(s).`
    );

    for (const pluginFile of pluginFiles) {
      await import(
        pathToFileURL(pluginFile).href
      );
    }
  }

  private async discoverPluginFiles(): Promise<string[]> {
    let entries;

    try {
      entries = await fs.readdir(
        this.pluginRoot,
        {
          withFileTypes: true,
        }
      );
    } catch (error) {
      const code =
        (error as NodeJS.ErrnoException).code;

      if (code === "ENOENT") {
        return [];
      }

      throw error;
    }

    return entries
      .filter((entry) => {
        if (!entry.isFile()) {
          return false;
        }

        if (entry.name.endsWith(".d.ts")) {
          return false;
        }

        return /Plugin\.(?:js|mjs|cjs|ts)$/.test(
          entry.name
        );
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name)
      )
      .map((entry) =>
        path.join(
          this.pluginRoot,
          entry.name
        )
      );
  }
}
