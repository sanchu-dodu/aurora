export interface PipelineStep {

  name: string;

  execute(): Promise<void>;

  rollback?(): Promise<void>;

}