import { PluginRunner } from "./pluginRunner.js";

export class RuntimeManager {

  private runner =
    new PluginRunner();

  async start(): Promise<void> {

    console.log("");

    console.log(
      "═══════════════════════════════"
    );

    console.log(
      " Aurora Runtime"
    );

    console.log(
      "═══════════════════════════════"
    );

    await this.runner.start();

    console.log("");

    console.log(
      "✔ Runtime ready."
    );

  }

}