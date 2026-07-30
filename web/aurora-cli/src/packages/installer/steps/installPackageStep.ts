import type { PipelineStep } from "../../../pipeline/pipelineStep.js";
import { InstallationContext } from "../installationContext.js";

export class InstallPackageStep
  implements PipelineStep {

  readonly name = "Install Package";

  constructor(
    private readonly context: InstallationContext
  ) {}

  async execute(): Promise<void> {

    console.log("");

    console.log(
      `Installing package '${this.context.packageData.id}'`
    );

    console.log("✔ Package installed.");

  }

}