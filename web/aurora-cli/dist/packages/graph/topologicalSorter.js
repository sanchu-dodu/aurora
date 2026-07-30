export class TopologicalSorter {
    graph;
    constructor(graph) {
        this.graph = graph;
    }
    sort() {
        const visited = new Set();
        const result = [];
        for (const pkg of this.graph.getPackages()) {
            this.visit(pkg, visited, result);
        }
        return result;
    }
    visit(pkg, visited, result) {
        if (visited.has(pkg)) {
            return;
        }
        visited.add(pkg);
        for (const dependency of this.graph.getDependencies(pkg)) {
            this.visit(dependency, visited, result);
        }
        result.push(pkg);
    }
}
//# sourceMappingURL=topologicalSorter.js.map