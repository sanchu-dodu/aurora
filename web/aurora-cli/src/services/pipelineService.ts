import { PipelineRunner } from "../pipeline/pipelineRunner.js";

import { createPipelineContext } from "../pipeline/pipelineBuilder.js";

import { ValidateProjectStep } from "../pipeline/steps/validateProject.js";
import { CreateProjectStep } from "../pipeline/steps/createProject.js";
import { InitializeGitStep } from "../pipeline/steps/initializeGit.js";
import { ConfigureAuroraStep } from "../pipeline/steps/configureAurora.js";


export async function runProjectPipeline(
  framework: string,
  projectName: string
): Promise<void> {


  const context =
    createPipelineContext(
      framework,
      projectName
    );


  const pipeline =
    new PipelineRunner();


  pipeline.addStep(
    new ValidateProjectStep(
      projectName
    )
  );


  pipeline.addStep(
    new CreateProjectStep(
      context
    )
  );


  pipeline.addStep(
    new InitializeGitStep(
      projectName
    )
  );


  pipeline.addStep(
    new ConfigureAuroraStep(
      projectName
    )
  );


  await pipeline.run();

}