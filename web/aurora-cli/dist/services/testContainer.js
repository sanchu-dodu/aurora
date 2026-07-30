import { container } from "../core/serviceContainer.js";
import "../core/logger.js";
const logger = container.resolve("logger");
logger.success("Service Container is working!");
//# sourceMappingURL=testContainer.js.map