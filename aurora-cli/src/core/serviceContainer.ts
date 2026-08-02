class ServiceContainer {
  private services = new Map<string, unknown>();

  register<T>(name: string, service: T): void {
    this.services.set(name, service);
  }

  resolve<T>(name: string): T {
    const service = this.services.get(name);

    if (!service) {
      throw new Error(
        `Service '${name}' is not registered.`
      );
    }

    return service as T;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }
}

export const container = new ServiceContainer();