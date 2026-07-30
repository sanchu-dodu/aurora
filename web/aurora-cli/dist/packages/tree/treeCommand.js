import { DependencyTree } from "./dependencyTree.js";
export async function showDependencyTree(packageId) {
    console.log();
    console.log("Dependency Tree");
    console.log("================");
    console.log();
    const tree = new DependencyTree();
    await tree.print(packageId);
}
//# sourceMappingURL=treeCommand.js.map