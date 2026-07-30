export class InstallationScheduler {
    graph;
    constructor(graph) {
        this.graph = graph;
    }
    createBatches() {
        const installed = new Set();
        const batches = [];
        while (installed.size <
            this.graph.getPackages().length) {
            const batch = [];
            for (const pkg of this.graph.getPackages()) {
                if (installed.has(pkg)) {
                    continue;
                }
                const dependencies = this.graph.getDependencies(pkg);
                const ready = dependencies.every((dep) => installed.has(dep));
                if (ready) {
                    batch.push(pkg);
                }
            }
            if (batch.length === 0) {
                throw new Error("Unable to create installation batches.");
            }
            batches.push(batch);
            for (const pkg of batch) {
                installed.add(pkg);
            }
        }
        return batches;
    }
}
//# sourceMappingURL=installationScheduler.js.map