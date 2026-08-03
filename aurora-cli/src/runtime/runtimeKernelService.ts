import type { KernelService } from "../kernel/kernelService.js";
import { PluginLoader } from "./pluginLoader.js";
import { RuntimeManager } from "./runtimeManager.js";

export class RuntimeKernelService
implements KernelService {
  readonly id = "runtime";

  constructor(
    private readonly loader =
      new PluginLoader(),
    private readonly runtime =
      new RuntimeManager()
  ) {}

  get isRunning(): boolean {
    return this.runtime.isRunning;
  }

  async initialize(): Promise<void> {
    await this.loader.load();
    await this.runtime.start();
  }

  async shutdown(): Promise<void> {
    await this.runtime.stop();
  }
}
