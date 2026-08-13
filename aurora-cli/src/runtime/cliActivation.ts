import type {
  Kernel,
} from "../kernel/kernel.js";

import {
  discoverManifests,
} from "../packages/discovery/discoverManifests.js";

import type {
  RecoveryService,
} from "../packages/recovery/recoveryService.js";

import {
  registerAllGenerators,
} from "../generator/registry/registerGenerators.js";

import {
  discoverTemplates,
} from "../templates/registry/templateRegistry.js";

import type {
  PluginLoader,
} from "./pluginLoader.js";

import type {
  RuntimeManager,
} from "./runtimeManager.js";

export interface CliActivation {
  prepareCatalog(): Promise<void>;

  activate(): Promise<void>;

  shutdown(): Promise<void>;
}

export interface CliActivationOptions {
  packageRoot?: string;
}

export class AuroraCliActivation
implements CliActivation {
  private kernel:
    Kernel | undefined;

  private catalogPrepared =
    false;

  private activated =
    false;

  constructor(
    private readonly options:
      CliActivationOptions = {}
  ) {}

  async prepareCatalog():
    Promise<void> {
    if (this.catalogPrepared) {
      return;
    }

    await import(
      "../features/modules/authFeature.js"
    );

    await import(
      "../templates/registerNext.js"
    );

    await discoverTemplates();

    registerAllGenerators();

    await discoverManifests(
      this.options.packageRoot
    );

    this.catalogPrepared = true;
  }

  async activate(): Promise<void> {
    if (this.activated) {
      return;
    }

    await this.prepareCatalog();

    const [
      { createContainer },
      { KernelBuilder },
      { RuntimeKernelService },
    ] = await Promise.all([
      import(
        "../container/bootstrap/createContainer.js"
      ),
      import(
        "../kernel/kernelBuilder.js"
      ),
      import(
        "./runtimeKernelService.js"
      ),
    ]);

    const container =
      createContainer();

    const pluginLoader =
      container.resolve<PluginLoader>(
        "PluginLoader"
      );

    const runtimeManager =
      container.resolve<RuntimeManager>(
        "RuntimeManager"
      );

    const kernel =
      new KernelBuilder()
        .withWorkspace(
          process.cwd()
        )
        .withProjectName(
          "Aurora CLI"
        )
        .addService(
          new RuntimeKernelService(
            pluginLoader,
            runtimeManager
          )
        )
        .build();

    this.kernel = kernel;

    await kernel.boot();

    kernel.start();

    const recovery =
      container.resolve<RecoveryService>(
        "RecoveryService"
      );

    await recovery.check();

    this.activated = true;
  }

  async shutdown(): Promise<void> {
    if (!this.kernel) {
      return;
    }

    const kernel =
      this.kernel;

    this.kernel = undefined;
    this.activated = false;

    await kernel.shutdown();
  }
}
