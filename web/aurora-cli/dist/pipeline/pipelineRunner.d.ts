import { PipelineStep } from "./pipelineStep.js";
export declare class PipelineRunner {
    private steps;
    addStep(step: PipelineStep): void;
    run(): Promise<void>;
}
