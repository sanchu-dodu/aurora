import {
  getPluginCatalog,
} from "../runtime/plugins/pluginCatalog.js";

export async function pluginListCommand():
  Promise<void> {
  console.log("");
  console.log(
    "Installed Plugins"
  );
  console.log(
    "================="
  );

  const plugins =
    getPluginCatalog();

  if (plugins.length === 0) {
    console.log(
      "No plugins installed."
    );

    return;
  }

  for (
    const plugin
    of plugins
  ) {
    console.log(
      `✔ ${plugin.name} (${plugin.version})`
    );
  }
}
