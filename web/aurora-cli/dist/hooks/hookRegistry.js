const hooks = new Map();
export function registerHook(name, handler) {
    const list = hooks.get(name) ?? [];
    list.push(handler);
    hooks.set(name, list);
}
export function getHooks(name) {
    return hooks.get(name) ?? [];
}
//# sourceMappingURL=hookRegistry.js.map