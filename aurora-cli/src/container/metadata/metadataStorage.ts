export interface ServiceMetadata {
  target: Function;
  singleton: boolean;
}

export class MetadataStorage {
  private readonly services =
    new Map<Function, ServiceMetadata>();

  register(metadata: ServiceMetadata): void {
    this.services.set(
      metadata.target,
      metadata
    );
  }

  get(
    target: Function
  ): ServiceMetadata | undefined {
    return this.services.get(target);
  }

  has(
    target: Function
  ): boolean {
    return this.services.has(target);
  }

  getAll(): ServiceMetadata[] {
    return [...this.services.values()];
  }
}

export const metadataStorage =
  new MetadataStorage();