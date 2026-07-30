import type { ServiceDescriptor } from "./serviceDescriptor.js";


export class ServiceProvider {

  private instances =
    new Map<string, unknown>();


  constructor(
    private descriptors:
      Map<string, ServiceDescriptor>
  ) {}



  resolve<T>(
    token: string
  ): T {


    const descriptor =
      this.descriptors.get(token);


    if (!descriptor) {

      throw new Error(
        `Service not registered: ${token}`
      );

    }



    const existing =
      this.instances.get(token);



    if (existing) {

      return existing as T;

    }



    const instance =
      new descriptor.implementation();



    this.instances.set(
      token,
      instance
    );


    return instance as T;

  }

}