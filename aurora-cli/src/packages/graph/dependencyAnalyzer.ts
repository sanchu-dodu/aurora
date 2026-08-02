import { DependencyGraph } from "./dependencyGraph.js";


export class DependencyAnalyzer {


  constructor(
    private graph: DependencyGraph
  ) {}


  checkCircularDependencies(): void {


    console.log(
      "Checking for circular dependencies..."
    );


    const visited =
      new Set<string>();


    const visiting =
      new Set<string>();


    for (
      const pkg of this.graph.getPackages()
    ) {


      if (
        this.detectCycle(
          pkg,
          visited,
          visiting
        )
      ) {

        throw new Error(
          `Circular dependency detected involving ${pkg}`
        );

      }

    }


    console.log(
      "No circular dependencies detected."
    );

  }



  private detectCycle(
    packageId: string,
    visited: Set<string>,
    visiting: Set<string>
  ): boolean {


    if (
      visiting.has(packageId)
    ) {

      return true;

    }


    if (
      visited.has(packageId)
    ) {

      return false;

    }


    visiting.add(
      packageId
    );


    for (
      const dependency of
      this.graph.getDependencies(packageId)
    ) {


      if (
        this.detectCycle(
          dependency,
          visited,
          visiting
        )
      ) {

        return true;

      }

    }


    visiting.delete(
      packageId
    );


    visited.add(
      packageId
    );


    return false;

  }


}