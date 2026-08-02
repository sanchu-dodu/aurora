import {
  getHooks,
  HookName,
} from "./hookRegistry.js";

export async function runHook(
  name: HookName,
  payload?: unknown
): Promise<void> {

  const handlers =
    getHooks(name);

  for (const handler of handlers) {

    await handler(payload);

  }

}