import { DependencyGraph } from "../graph/dependencyGraph.js";
export declare class InstallationScheduler {
    private graph;
    constructor(graph: DependencyGraph);
    createBatches(): string[][];
}
