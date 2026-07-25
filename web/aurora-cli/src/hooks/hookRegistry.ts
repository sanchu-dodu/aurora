export type HookName =
  | "beforePipeline"
  | "afterPipeline"
  | "beforeStep"
  | "afterStep"
  | "pipelineError";

export type HookHandler =
  (payload?: unknown) => Promise<void>;

const hooks = new Map<
  HookName,
  HookHandler[]
>();

export function registerHook(
  name: HookName,
  handler: HookHandler
): void {

  const list =
    hooks.get(name) ?? [];

  list.push(handler);

  hooks.set(name, list);

}

export function getHooks(
  name: HookName
): HookHandler[] {

  return hooks.get(name) ?? [];

}