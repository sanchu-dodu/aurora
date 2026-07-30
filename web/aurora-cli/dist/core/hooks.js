class HookManager {
    hooks = new Map();
    register(name, hook) {
        const list = this.hooks.get(name) ?? [];
        list.push(hook);
        this.hooks.set(name, list);
    }
    async execute(name) {
        const hooks = this.hooks.get(name);
        if (!hooks)
            return;
        for (const hook of hooks) {
            await hook();
        }
    }
}
export const hookManager = new HookManager();
import { container } from "./serviceContainer.js";
container.register("hooks", hookManager);
//# sourceMappingURL=hooks.js.map