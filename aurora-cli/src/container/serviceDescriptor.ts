import { ServiceLifetime } from "./lifetime.js";


export interface ServiceDescriptor<T = unknown> {

  token: string;

  implementation:
    new (...args: any[]) => T;

  lifetime:
    ServiceLifetime;

}