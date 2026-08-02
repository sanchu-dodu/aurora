import { ServiceContainer } from "../serviceContainer.js";
import { Logger } from "./logger.js";

const container =
  new ServiceContainer();

const logger =
  container.resolve(Logger);

logger.log("Dependency Injection works!");