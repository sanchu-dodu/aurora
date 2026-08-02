import { DependencyTree } from "./dependencyTree.js";

export async function showDependencyTree(
  packageId: string
): Promise<void> {

  console.log();
  console.log("Dependency Tree");
  console.log("================");
  console.log();

  const tree =
    new DependencyTree();

  await tree.print(
    packageId
  );

}