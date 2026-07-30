import { getHooks } from "../../hooks/hookRegistry.js";

export class HookRunner {

  async execute(
    event: string,
    ...args: unknown[]
  ): Promise<void> {

    const hooks = getHooks(event);

    for (const hook of hooks) {

      await hook(...args);

    }

  }

}