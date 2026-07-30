export class DependencyGraph {
    graph = new Map();
    addPackage(id, dependencies) {
        this.graph.set(id, dependencies);
    }
    getDependencies(id) {
        return (this.graph.get(id)
            ?? []);
    }
    getPackages() {
        return Array.from(this.graph.keys());
    }
    print() {
        console.log();
        console.log("Dependency Graph");
        console.log("================");
        for (const [pkg, deps] of this.graph) {
            console.log(`${pkg} -> ${deps.length
                ? deps.join(", ")
                : "(none)"}`);
        }
        console.log();
    }
}
//# sourceMappingURL=dependencyGraph.js.map