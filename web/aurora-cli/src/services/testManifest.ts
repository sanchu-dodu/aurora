import { loadTemplateManifest } from "./manifest.js";

const manifest = await loadTemplateManifest("nextjs");

console.log(manifest);