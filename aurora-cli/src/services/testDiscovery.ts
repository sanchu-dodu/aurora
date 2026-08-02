import { discoverTemplates } from "./discovery.js";

const templates = await discoverTemplates();

console.log(templates);