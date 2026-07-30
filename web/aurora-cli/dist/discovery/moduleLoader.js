export async function loadModules(modules) {
    for (const modulePath of modules) {
        await import(modulePath);
    }
}
//# sourceMappingURL=moduleLoader.js.map