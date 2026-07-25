import { container } from "../core/serviceContainer.js";
import "../core/logger.js";

const logger = container.resolve<any>("logger");

logger.success("Service Container is working!");