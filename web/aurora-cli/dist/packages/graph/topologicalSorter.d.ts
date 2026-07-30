import { DependencyGraph } from "./dependencyGraph.js";
export declare class TopologicalSorter {
    private graph;
    constructor(graph: DependencyGraph);
    sort(): string[];
    private visit;
}
