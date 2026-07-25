import "../core/eventBus.js";
import { eventBus } from "../core/eventBus.js";

eventBus.on("project.created", async (payload) => {
  console.log("Project created:");
  console.log(payload);
});

await eventBus.emit("project.created", {
  name: "AuroraUltimate",
});