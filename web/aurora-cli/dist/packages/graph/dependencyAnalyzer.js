export class DependencyAnalyzer {
    graph;
    constructor(graph) {
        this.graph = graph;
    }
    checkCircularDependencies() {
        console.log("Checking for circular dependencies...");
        const visited = new Set();
        const visiting = new Set();
        for (const pkg of this.graph.getPackages()) {
            if (this.detectCycle(pkg, visited, visiting)) {
                throw new Error(`Circular dependency detected involving ${pkg}`);
            }
        }
        console.log("No circular dependencies detected.");
    }
    detectCycle(packageId, visited, visiting) {
        if (visiting.has(packageId)) {
            return true;
        }
        if (visited.has(packageId)) {
            return false;
        }
        visiting.add(packageId);
        for (const dependency of this.graph.getDependencies(packageId)) {
            if (this.detectCycle(dependency, visited, visiting)) {
                return true;
            }
        }
        visiting.delete(packageId);
        visited.add(packageId);
        return false;
    }
}
//# sourceMappingURL=dependencyAnalyzer.js.map