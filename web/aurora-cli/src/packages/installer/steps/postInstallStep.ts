import type { PipelineStep } from "../../../pipeline/pipelineStep.js";
import { InstallationContext } from "../installationContext.js";

export class PostInstallStep
  implements PipelineStep {

  readonly name = "Post Install";

  constructor(
    private readonly context: InstallationContext
  ) {}

  async execute(): Promise<void> {

    console.log("");

    console.log("Running post-install tasks...");

    console.log(
      `Installed ${this.context.packageData.id}`
    );

    console.log("✔ Post-install complete.");

  }

}