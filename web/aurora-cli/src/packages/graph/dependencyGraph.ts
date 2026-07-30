export class DependencyGraph {

  private graph =
    new Map<string, string[]>();


  addPackage(
    id: string,
    dependencies: string[]
  ): void {

    this.graph.set(
      id,
      dependencies
    );

  }


  getDependencies(
    id: string
  ): string[] {

    return (
      this.graph.get(id)
      ?? []
    );

  }


  getPackages(): string[] {

    return Array.from(
      this.graph.keys()
    );

  }


  print(): void {

    console.log();

    console.log(
      "Dependency Graph"
    );

    console.log(
      "================"
    );


    for (
      const [pkg, deps]
      of this.graph
    ) {

      console.log(
        `${pkg} -> ${
          deps.length
          ? deps.join(", ")
          : "(none)"
        }`
      );

    }

    console.log();

  }

}