import { ServiceCollection } from "../serviceCollection.js";

import { RuntimeManager } from "../../runtime/runtimeManager.js";
import { PluginLoader } from "../../runtime/pluginLoader.js";
import { RecoveryService } from "../../packages/recovery/recoveryService.js";

export function registerCoreServices(
  services: ServiceCollection
): void {

  services.addSingleton(
    "RuntimeManager",
    RuntimeManager
  );

  services.addSingleton(
    "PluginLoader",
    PluginLoader
  );

  services.addSingleton(
    "RecoveryService",
    RecoveryService
  );

}