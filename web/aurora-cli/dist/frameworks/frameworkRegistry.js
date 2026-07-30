import { NextJsAdapter } from "./nextjsAdapter.js";
const adapters = new Map();
adapters.set("nextjs", new NextJsAdapter());
export function getFrameworkAdapter(framework) {
    const adapter = adapters.get(framework);
    if (!adapter) {
        throw new Error(`Unsupported framework: ${framework}`);
    }
    return adapter;
}
//# sourceMappingURL=frameworkRegistry.js.map