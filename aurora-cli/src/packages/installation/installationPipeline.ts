import { PipelineRunner } from "../../pipeline/pipelineRunner.js";

import { ValidatePackageStep } from "../installer/steps/validatePackageStep.js";
import { ResolveDependenciesStep } from "../installer/steps/resolveDependenciesStep.js";
import { InstallDependenciesStep } from "../installer/steps/installDependenciesStep.js";
import { InstallPackageStep } from "../installer/steps/installPackageStep.js";
import { PostInstallStep } from "../installer/steps/postInstallStep.js";

import type { InstallationContext } from "../installer/installationContext.js";

export async function runInstallation(
  context: InstallationContext
): Promise<void> {
  const pipeline = new PipelineRunner();

  pipeline.addStep(new ValidatePackageStep(context));
  pipeline.addStep(new ResolveDependenciesStep(context));
  pipeline.addStep(new InstallDependenciesStep(context));
  pipeline.addStep(new InstallPackageStep(context));
  pipeline.addStep(new PostInstallStep(context));

  await pipeline.run();
}
