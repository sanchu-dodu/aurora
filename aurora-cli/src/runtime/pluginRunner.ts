import type { AuroraPlugin } from "./plugins/plugin.js";
import { getPlugins } from "./plugins/pluginRegistry.js";

export type PluginProvider =
  () => AuroraPlugin[];

export class PluginRunner {
  private readonly activatedPlugins:
    AuroraPlugin[] = [];

  private started = false;

  constructor(
    private readonly pluginProvider:
      PluginProvider = getPlugins
  ) {}

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    console.log("");
    console.log("Starting Aurora Runtime...");

    const plugins =
      this.pluginProvider();

    try {
      for (const plugin of plugins) {
        console.log(
          `Loading ${plugin.name}...`
        );

        await plugin.activate();

        this.activatedPlugins.push(
          plugin
        );
      }

      this.started = true;

      console.log("");
      console.log(
        `Loaded ${this.activatedPlugins.length} plugin(s).`
      );
    } catch (error) {
      await this.rollbackActivatedPlugins();

      throw error;
    }
  }

  async stop(): Promise<void> {
    if (
      !this.started &&
      this.activatedPlugins.length === 0
    ) {
      return;
    }

    const errors: unknown[] = [];

    for (
      let index =
        this.activatedPlugins.length - 1;
      index >= 0;
      index -= 1
    ) {
      const plugin =
        this.activatedPlugins[index];

      try {
        console.log(
          `Stopping ${plugin.name}...`
        );

        await plugin.deactivate();
      } catch (error) {
        errors.push(error);
      }
    }

    this.activatedPlugins.length = 0;
    this.started = false;

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "One or more runtime plugins failed to stop."
      );
    }
  }

  private async rollbackActivatedPlugins():
    Promise<void> {
    for (
      let index =
        this.activatedPlugins.length - 1;
      index >= 0;
      index -= 1
    ) {
      try {
        await this.activatedPlugins[
          index
        ].deactivate();
      } catch {
        // Preserve the original activation error.
      }
    }

    this.activatedPlugins.length = 0;
    this.started = false;
  }
}
