import type { PipelineStep } from "../../../pipeline/pipelineStep.js";
import { InstallationContext } from "../installationContext.js";

export class ValidatePackageStep
implements PipelineStep {

  readonly name = "Validate Package";

  constructor(

    private readonly context: InstallationContext

  ) {}

  async execute(): Promise<void> {

    if (!this.context.packageData) {

      throw new Error(
        "Package not found."
      );

    }

    console.log(
      `✔ ${this.context.packageData.id} validated`
    );

  }

}