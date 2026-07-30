import type { PipelineStep } from "../../../pipeline/pipelineStep.js";
import { InstallationContext } from "../installationContext.js";

export class InstallDependenciesStep
  implements PipelineStep {

  readonly name = "Install Dependencies";

  constructor(
    private readonly context: InstallationContext
  ) {}

  async execute(): Promise<void> {

    console.log("");

    console.log("Installing dependencies...");

    for (const dependency of this.context.packageData.dependencies) {

      console.log(`Installing ${dependency}`);

      this.context.installedDependencies.push(
        dependency
      );

    }

    console.log("✔ Dependencies installed.");

  }

}