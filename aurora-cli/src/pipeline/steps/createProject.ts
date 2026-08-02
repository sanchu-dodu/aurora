import fs from "fs-extra";

import { getFrameworkAdapter } from "../../frameworks/frameworkRegistry.js";
import { PipelineContext } from "../pipelineContext.js";

export class CreateProjectStep {

  name = "Create Project";

  constructor(
    private context: PipelineContext
  ) {}

  async execute(): Promise<void> {

    const adapter = getFrameworkAdapter(
      this.context.framework
    );

    await adapter.createProject(
      this.context.projectName
    );

  }

  async rollback(): Promise<void> {

    if (
      await fs.pathExists(
        this.context.projectName
      )
    ) {

      await fs.remove(
        this.context.projectName
      );

      console.log(
        "Deleted project directory."
      );

    }

  }

}