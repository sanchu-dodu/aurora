import { metadataReader } from "../metadata/metadataReader.js";

export class InstanceFactory {

  create<T>(
    ctor: new (...args: any[]) => T
  ): T {

    const metadata =
      metadataReader.get(ctor);

    if (!metadata) {
      throw new Error(
        `Service ${ctor.name} is not registered.`
      );
    }

    return new ctor();

  }

}

export const instanceFactory =
  new InstanceFactory();