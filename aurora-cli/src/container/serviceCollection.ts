import type {
  ServiceDescriptor,
} from "./serviceDescriptor.js";

import {
  ServiceLifetime,
} from "./lifetime.js";

import {
  ServiceProvider,
} from "./serviceProvider.js";

type ServiceConstructor<T> =
  new (...args: any[]) => T;

export class ServiceCollection {
  private readonly services =
    new Map<
      string,
      ServiceDescriptor
    >();

  addSingleton<T>(
    token: string,
    implementation:
      ServiceConstructor<T>
  ): void {
    this.register(
      token,
      implementation,
      ServiceLifetime.Singleton
    );
  }

  addTransient<T>(
    token: string,
    implementation:
      ServiceConstructor<T>
  ): void {
    this.register(
      token,
      implementation,
      ServiceLifetime.Transient
    );
  }

  build(): ServiceProvider {
    return new ServiceProvider(
      new Map(this.services)
    );
  }

  private register<T>(
    token: string,
    implementation:
      ServiceConstructor<T>,
    lifetime: ServiceLifetime
  ): void {
    const normalizedToken =
      token.trim();

    if (!normalizedToken) {
      throw new Error(
        "Service token cannot be empty."
      );
    }

    if (
      this.services.has(
        normalizedToken
      )
    ) {
      throw new Error(
        `Service '${normalizedToken}' is already registered.`
      );
    }

    this.services.set(
      normalizedToken,
      {
        token: normalizedToken,
        implementation,
        lifetime,
      }
    );
  }
}
