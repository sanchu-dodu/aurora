import { getHooks, } from "./hookRegistry.js";
export async function runHook(name, payload) {
    const handlers = getHooks(name);
    for (const handler of handlers) {
        await handler(payload);
    }
}
//# sourceMappingURL=hookRunner.js.map