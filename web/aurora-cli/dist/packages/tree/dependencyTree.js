import { PackageRegistry } from "../registry/registry.js";
export class DependencyTree {
    registry = new PackageRegistry();
    async print(packageId, indent = "") {
        const manifest = await this.registry.getPackage(packageId);
        console.log(`${indent}${packageId}`);
        const dependencies = manifest.dependencies ?? [];
        for (let i = 0; i < dependencies.length; i++) {
            const last = i === dependencies.length - 1;
            const prefix = last
                ? "└── "
                : "├── ";
            await this.print(dependencies[i], indent + prefix);
        }
    }
}
//# sourceMappingURL=dependencyTree.js.map