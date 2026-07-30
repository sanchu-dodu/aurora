class ServiceContainer {
    services = new Map();
    register(name, service) {
        this.services.set(name, service);
    }
    resolve(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service '${name}' is not registered.`);
        }
        return service;
    }
    has(name) {
        return this.services.has(name);
    }
}
export const container = new ServiceContainer();
//# sourceMappingURL=serviceContainer.js.map