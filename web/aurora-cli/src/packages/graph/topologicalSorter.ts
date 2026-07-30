import { DependencyGraph } from "./dependencyGraph.js";


export class TopologicalSorter {


  constructor(
    private graph: DependencyGraph
  ) {}


  sort(): string[] {

    const visited =
      new Set<string>();

    const result: string[] = [];


    for (
      const pkg of this.graph.getPackages()
    ) {

      this.visit(
        pkg,
        visited,
        result
      );

    }


    return result;

  }



  private visit(
    pkg: string,
    visited: Set<string>,
    result: string[]
  ): void {


    if (
      visited.has(pkg)
    ) {

      return;

    }


    visited.add(pkg);


    for (
      const dependency of
      this.graph.getDependencies(pkg)
    ) {


      this.visit(
        dependency,
        visited,
        result
      );

    }


    result.push(pkg);

  }


}