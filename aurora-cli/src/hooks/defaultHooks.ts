import { registerHook } from "./hookRegistry.js";
import { PipelineStep } from "../pipeline/pipelineStep.js";

registerHook(
  "beforePipeline",
  async () => {

    console.log("");
    console.log("🚀 Aurora Engine Started");

  }
);

registerHook(
  "afterPipeline",
  async () => {

    console.log("");
    console.log("🎉 Aurora Engine Finished");

  }
);

registerHook(
  "beforeStep",
  async payload => {

    const step = payload as PipelineStep;

    console.log(
      `Preparing ${step.name}...`
    );

  }
);

registerHook(
  "afterStep",
  async payload => {

    const step = payload as PipelineStep;

    console.log(
      `Finished ${step.name}.`
    );

  }
);

registerHook(
  "pipelineError",
  async error => {

    console.log("");
    console.error(
      "❌ Pipeline terminated."
    );

    if (error instanceof Error) {
      console.error(error.message);
    }

  }
);