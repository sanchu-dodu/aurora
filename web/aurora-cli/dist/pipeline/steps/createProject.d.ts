import { PipelineContext } from "../pipelineContext.js";
export declare class CreateProjectStep {
    private context;
    name: string;
    constructor(context: PipelineContext);
    execute(): Promise<void>;
    rollback(): Promise<void>;
}
