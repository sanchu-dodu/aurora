export declare class DependencyInspector {
    private registry;
    findDependents(packageId: string): Promise<string[]>;
}
