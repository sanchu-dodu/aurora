import { PluginRunner } from "./pluginRunner.js";

export class RuntimeManager {
  private readonly runner =
    new PluginRunner();

  get isRunning(): boolean {
    return this.runner.isStarted;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

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
    console.log("✔ Runtime ready.");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log("");
    console.log("Stopping Aurora Runtime...");

    await this.runner.stop();

    console.log("✔ Runtime stopped.");
  }
}
