import ora from "ora";

import { PipelineStep } from "./pipelineStep.js";
import { getHooks } from "../hooks/hookRegistry.js";

export class PipelineRunner {

  private steps: PipelineStep[] = [];

  addStep(
    step: PipelineStep
  ): void {

    this.steps.push(step);

  }

  async run(): Promise<void> {

    console.log("");
    console.log("Aurora Pipeline");
    console.log("================");
    console.log("");

    const completed: PipelineStep[] = [];

    for (const hook of getHooks("beforePipeline")) {
      await hook();
    }

    try {

      for (const step of this.steps) {

        for (const hook of getHooks("beforeStep")) {
          await hook(step);
        }

        const spinner = ora(step.name).start();

        await step.execute();

        spinner.succeed(step.name);

        completed.push(step);

        for (const hook of getHooks("afterStep")) {
          await hook(step);
        }

      }

      for (const hook of getHooks("afterPipeline")) {
        await hook();
      }

    } catch (error) {

      console.log("");
      console.log("Rolling back...");

      for (const step of completed.reverse()) {

        if (step.rollback) {

          console.log(
            `↩ Rolling back ${step.name}`
          );

          await step.rollback();

        }

      }

      for (const hook of getHooks("pipelineError")) {
        await hook(error);
      }

      throw error;

    }

  }

}