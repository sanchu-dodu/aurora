import { Command } from "commander";
import { showBanner } from "./utils/banner.js";
import "./commands/initRegistration.js";
import "./commands/doctorRegistration.js";
import "./commands/listRegistration.js";
import "./commands/pluginRegistration.js";
import "./commands/configRegistration.js";
import "./commands/templateRegistration.js";
import "./features/modules/authFeature.js";
import "./commands/featureRegistration.js";
import "./commands/generateRegistration.js";
import "./hooks/defaultHooks.js";
import "./templates/registerNext.js";
import { discoverManifests } from "./packages/discovery/discoverManifests.js";
import { RecoveryService } from "./packages/recovery/recoveryService.js";
import { discoverPackages, } from "./packages/discovery/packageDiscovery.js";
import "./commands/packageRegistration.js";
import "./commands/recoveryRegistration.js";
import { discoverPlugins } from "./discovery/pluginDiscovery.js";
import { registerAllCommands } from "./core/commandRegistry.js";
import { initializePlugins } from "./core/pluginLoader.js";
const program = new Command();
program
    .name("aurora")
    .description("Aurora Command Line Interface")
    .version("0.1.0");
program.action(() => {
    showBanner();
    console.log("✅ Aurora CLI started successfully.");
});
registerAllCommands(program);
// Automatically discover and load plugins
await discoverPlugins();
// Initialize discovered plugins
await initializePlugins();
import { discoverTemplates, } from "./templates/registry/templateRegistry.js";
await discoverTemplates();
await discoverPackages();
registerAllGenerators();
import { registerAllGenerators, } from "./generator/registry/registerGenerators.js";
await discoverManifests();
const recovery = new RecoveryService(process.cwd());
await recovery.check();
program.parse(process.argv);
//# sourceMappingURL=index.js.map