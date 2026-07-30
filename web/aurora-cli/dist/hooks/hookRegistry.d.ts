export type HookName = "beforePipeline" | "afterPipeline" | "beforeStep" | "afterStep" | "pipelineError";
export type HookHandler = (payload?: unknown) => Promise<void>;
export declare function registerHook(name: HookName, handler: HookHandler): void;
export declare function getHooks(name: HookName): HookHandler[];
