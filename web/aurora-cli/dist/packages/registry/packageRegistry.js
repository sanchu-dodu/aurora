const packages = new Map();
export function registerPackage(pkg) {
    packages.set(pkg.id, pkg);
}
export function getPackage(id) {
    const pkg = packages.get(id);
    if (!pkg) {
        throw new Error(`Unknown package: ${id}`);
    }
    return pkg;
}
export function listPackages() {
    return [
        ...packages.values()
    ];
}
//# sourceMappingURL=packageRegistry.js.map