import type {
  ServiceDescriptor,
} from "./serviceDescriptor.js";

import {
  ServiceLifetime,
} from "./lifetime.js";

export class ServiceProvider {
  private readonly instances =
    new Map<string, unknown>();

  constructor(
    private readonly descriptors:
      ReadonlyMap<
        string,
        ServiceDescriptor
      >
  ) {}

  has(token: string): boolean {
    return this.descriptors.has(
      token.trim()
    );
  }

  resolve<T>(
    token: string
  ): T {
    const normalizedToken =
      token.trim();

    if (!normalizedToken) {
      throw new Error(
        "Service token cannot be empty."
      );
    }

    const descriptor =
      this.descriptors.get(
        normalizedToken
      );

    if (!descriptor) {
      throw new Error(
        `Service not registered: ${normalizedToken}`
      );
    }

    const isSingleton =
      descriptor.lifetime ===
      ServiceLifetime.Singleton;

    if (
      isSingleton &&
      this.instances.has(
        normalizedToken
      )
    ) {
      return this.instances.get(
        normalizedToken
      ) as T;
    }

    const instance =
      new descriptor.implementation();

    if (isSingleton) {
      this.instances.set(
        normalizedToken,
        instance
      );
    }

    return instance as T;
  }
}
