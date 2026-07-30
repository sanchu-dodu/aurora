import "../core/hooks.js";
import { hookManager } from "../core/hooks.js";
hookManager.register("before.project.create", async () => {
    console.log("Before project creation");
});
hookManager.register("after.project.create", async () => {
    console.log("After project creation");
});
await hookManager.execute("before.project.create");
console.log("Creating project...");
await hookManager.execute("after.project.create");
//# sourceMappingURL=testHooks.js.map