const config = {
    logLevel: "info",
    autoInstall: true,
    autoGit: true,
};
export function getConfig() {
    return config;
}
import { container } from "./serviceContainer.js";
container.register("config", config);
//# sourceMappingURL=config.js.map