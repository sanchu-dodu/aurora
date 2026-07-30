declare class ServiceContainer {
    private services;
    register<T>(name: string, service: T): void;
    resolve<T>(name: string): T;
    has(name: string): boolean;
}
export declare const container: ServiceContainer;
export {};
