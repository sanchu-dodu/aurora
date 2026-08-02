import { container } from "../core/serviceContainer.js";
import "../core/config.js";

const config = container.resolve<any>("config");

console.log(config);