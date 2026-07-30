import type { ServiceDescriptor } from "./serviceDescriptor.js";
import { ServiceLifetime } from "./lifetime.js";
import { ServiceProvider } from "./serviceProvider.js";

export class ServiceCollection {

  private services: ServiceDescriptor[] = [];

  addSingleton<T>(
    token: string,
    implementation: new (...args: any[]) => T
  ): void {

    this.services.push({
      token,
      implementation,
      lifetime: ServiceLifetime.Singleton
    });

  }

  addTransient<T>(
    token: string,
    implementation: new (...args: any[]) => T
  ): void {

    this.services.push({
      token,
      implementation,
      lifetime: ServiceLifetime.Transient
    });

  }

  build(): ServiceProvider {

    const registry = new Map<string, ServiceDescriptor>();

    for (const service of this.services) {
      registry.set(service.token, service);
    }

    return new ServiceProvider(registry);

  }

}