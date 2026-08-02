import { getHooks, type HookName } from "../../hooks/hookRegistry.js";

export class HookRunner {

  async execute(
    event: HookName,
    ...args: unknown[]
  ): Promise<void> {

    const hooks = getHooks(event);

    for (const hook of hooks) {

      await hook(...args);

    }

  }

}