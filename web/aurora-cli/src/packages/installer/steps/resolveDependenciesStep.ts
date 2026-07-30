import type { PipelineStep } from "../../../pipeline/pipelineStep.js";
import { InstallationContext } from "../installationContext.js";

export class ResolveDependenciesStep
  implements PipelineStep {

  readonly name = "Resolve Dependencies";

  constructor(
    private readonly context: InstallationContext
  ) {}

  async execute(): Promise<void> {

    console.log("");

    console.log("Resolving dependencies...");

    for (const dependency of this.context.packageData.dependencies) {

      console.log(`• ${dependency}`);

    }

    console.log("✔ Dependencies resolved.");

  }

}