import { PipelineContext } from "./pipelineContext.js";

export function createPipelineContext(
  framework: string,
  projectName: string
): PipelineContext {

  return {

    framework,

    projectName,

    projectPath: projectName,

    packageManager: "npm",

    templateId: framework,

    metadata: {},

  };

}