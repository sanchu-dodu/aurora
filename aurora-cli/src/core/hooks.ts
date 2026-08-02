type Hook = () => Promise<void> | void;

class HookManager {
  private hooks = new Map<string, Hook[]>();

  register(name: string, hook: Hook): void {
    const list = this.hooks.get(name) ?? [];
    list.push(hook);
    this.hooks.set(name, list);
  }

  async execute(name: string): Promise<void> {
    const hooks = this.hooks.get(name);

    if (!hooks) return;

    for (const hook of hooks) {
      await hook();
    }
  }
}

export const hookManager = new HookManager();
import { container } from "./serviceContainer.js";

container.register("hooks", hookManager);