import { registerHook } from "./hookRegistry.js";
registerHook("beforePipeline", async () => {
    console.log("");
    console.log("🚀 Aurora Engine Started");
});
registerHook("afterPipeline", async () => {
    console.log("");
    console.log("🎉 Aurora Engine Finished");
});
registerHook("beforeStep", async (payload) => {
    const step = payload;
    console.log(`Preparing ${step.name}...`);
});
registerHook("afterStep", async (payload) => {
    const step = payload;
    console.log(`Finished ${step.name}.`);
});
registerHook("pipelineError", async (error) => {
    console.log("");
    console.error("❌ Pipeline terminated.");
    if (error instanceof Error) {
        console.error(error.message);
    }
});
//# sourceMappingURL=defaultHooks.js.map