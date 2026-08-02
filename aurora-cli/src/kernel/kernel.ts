import type { KernelContext } from "./kernelContext.js";
import { KernelState } from "./kernelLifecycle.js";
import type { KernelService } from "./kernelService.js";
import { KernelVersion } from "./kernelVersion.js";

export class Kernel {
  private state = KernelState.Created;

  private readonly services =
    new Map<string, KernelService>();

  private readonly initializedServiceIds: string[] = [];

  public readonly version = KernelVersion.version();

  constructor(
    public readonly context: KernelContext,
    services: Iterable<KernelService> = []
  ) {
    for (const service of services) {
      this.registerService(service);
    }
  }

  get currentState(): KernelState {
    return this.state;
  }

  get serviceIds(): readonly string[] {
    return Array.from(this.services.keys());
  }

  hasService(id: string): boolean {
    return this.services.has(id);
  }

  getService<T extends KernelService = KernelService>(
    id: string
  ): T {
    const service = this.services.get(id);

    if (!service) {
      throw new Error(
        `Kernel service '${id}' is not registered.`
      );
    }

    return service as T;
  }

  registerService(service: KernelService): this {
    if (this.state !== KernelState.Created) {
      throw new Error(
        "Kernel services can only be registered before booting."
      );
    }

    if (!service.id.trim()) {
      throw new Error(
        "Kernel service id cannot be empty."
      );
    }

    if (this.services.has(service.id)) {
      throw new Error(
        `Kernel service '${service.id}' is already registered.`
      );
    }

    this.services.set(service.id, service);

    return this;
  }

  async boot(): Promise<void> {
    this.assertState(
      KernelState.Created,
      "boot"
    );

    this.state = KernelState.Booting;

    try {
      for (const [serviceId, service] of this.services) {
        await service.initialize();
        this.initializedServiceIds.push(serviceId);
      }

      this.state = KernelState.Ready;
    } catch (error) {
      await this.rollbackInitializedServices();
      this.state = KernelState.Stopped;

      throw error;
    }
  }

  start(): void {
    this.assertState(
      KernelState.Ready,
      "start"
    );

    this.state = KernelState.Running;
  }

  async shutdown(): Promise<void> {
    if (this.state === KernelState.Stopped) {
      return;
    }

    if (this.state === KernelState.Created) {
      this.state = KernelState.Stopped;
      return;
    }

    if (
      this.state !== KernelState.Ready &&
      this.state !== KernelState.Running
    ) {
      throw new Error(
        `Cannot shut down Kernel while it is in state '${KernelState[this.state]}'.`
      );
    }

    this.state = KernelState.ShuttingDown;

    const errors: unknown[] = [];

    for (
      let index = this.initializedServiceIds.length - 1;
      index >= 0;
      index -= 1
    ) {
      const serviceId =
        this.initializedServiceIds[index];

      const service = this.services.get(serviceId);

      if (!service) {
        continue;
      }

      try {
        await service.shutdown();
      } catch (error) {
        errors.push(error);
      }
    }

    this.initializedServiceIds.length = 0;
    this.state = KernelState.Stopped;

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "One or more Kernel services failed to shut down."
      );
    }
  }

  private async rollbackInitializedServices(): Promise<void> {
    for (
      let index = this.initializedServiceIds.length - 1;
      index >= 0;
      index -= 1
    ) {
      const serviceId =
        this.initializedServiceIds[index];

      const service = this.services.get(serviceId);

      if (!service) {
        continue;
      }

      try {
        await service.shutdown();
      } catch {
        // Preserve the original initialization error.
      }
    }

    this.initializedServiceIds.length = 0;
  }

  private assertState(
    expected: KernelState,
    operation: string
  ): void {
    if (this.state !== expected) {
      throw new Error(
        `Cannot ${operation} Kernel while it is in state '${KernelState[this.state]}'.`
      );
    }
  }
}
