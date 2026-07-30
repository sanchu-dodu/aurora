import { PackageRegistry } from "../registry/registry.js";
export class DependencyInspector {
    registry = new PackageRegistry();
    async findDependents(packageId) {
        const packages = await this.registry.getAllPackages();
        const dependents = [];
        for (const pkg of packages) {
            const deps = pkg.dependencies ?? [];
            if (deps.includes(packageId)) {
                dependents.push(pkg.id);
            }
        }
        return dependents;
    }
}
//# sourceMappingURL=dependencyInspector.js.map