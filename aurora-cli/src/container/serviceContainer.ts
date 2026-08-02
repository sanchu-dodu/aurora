import { instanceFactory } from "./factory/instanceFactory.js";

export class ServiceContainer {

  private readonly instances =
    new Map<Function, unknown>();

  resolve<T>(
    ctor: new (...args: any[]) => T
  ): T {

    if (this.instances.has(ctor)) {
      return this.instances.get(ctor) as T;
    }

    const instance =
      instanceFactory.create(ctor);

    this.instances.set(
      ctor,
      instance
    );

    return instance;

  }

}