export declare class DependencyGraph {
    private graph;
    addPackage(id: string, dependencies: string[]): void;
    getDependencies(id: string): string[];
    getPackages(): string[];
    print(): void;
}
