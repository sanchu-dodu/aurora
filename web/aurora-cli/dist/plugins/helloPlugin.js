import { registerPlugin, } from "../core/pluginRegistry.js";
registerPlugin({
    id: "hello",
    name: "Hello Plugin",
    version: "1.0.0",
    async initialize() {
        console.log("✅ Hello Plugin loaded.");
    },
});
//# sourceMappingURL=helloPlugin.js.map