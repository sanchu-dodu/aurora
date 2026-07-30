import { DependencyGraph } from "./dependencyGraph.js";
export declare class DependencyAnalyzer {
    private graph;
    constructor(graph: DependencyGraph);
    checkCircularDependencies(): void;
    private detectCycle;
}
