import { Command } from "commander";

import { showBanner } from "./utils/banner.js";

import "./commands/initRegistration.js";
import "./commands/doctorRegistration.js";
import "./commands/listRegistration.js";
import "./commands/pluginRegistration.js";
import "./commands/configRegistration.js";
import "./commands/templateRegistration.js";
import "./commands/featureRegistration.js";
import "./commands/generateRegistration.js";
import "./commands/packageRegistration.js";
import "./commands/recoveryRegistration.js";

import "./features/modules/authFeature.js";
import "./hooks/defaultHooks.js";
import "./templates/registerNext.js";
import "./container/bootstrap/containerBootstrap.js";
import "./container/examples/testContainer.js";

import { registerAllCommands } from "./core/commandRegistry.js";
import { initializePlugins } from "./core/pluginLoader.js";

import { discoverPlugins } from "./discovery/pluginDiscovery.js";
import { discoverTemplates } from "./templates/registry/templateRegistry.js";

import { discoverPackages } from "./packages/discovery/packageDiscovery.js";
import { discoverManifests } from "./packages/discovery/discoverManifests.js";

import { registerAllGenerators } from "./generator/registry/registerGenerators.js";

import { RecoveryService } from "./packages/recovery/recoveryService.js";

import { KernelBuilder } from "./kernel/kernelBuilder.js";
import { RuntimeKernelService } from "./runtime/runtimeKernelService.js";

import { container } from "./container/bootstrap/containerBootstrap.js";

const program = new Command();

program
  .name("aurora")
  .description("Aurora Command Line Interface")
  .version("0.1.0");

program.action(() => {
  console.log("Aurora CLI started successfully.");
});

async function main(): Promise<void> {
  showBanner();

  registerAllCommands(program);

  await discoverPlugins();
  await initializePlugins();

  await discoverTemplates();
  await discoverPackages();

  registerAllGenerators();

  await discoverManifests();

  const kernel = new KernelBuilder()
    .withWorkspace(process.cwd())
    .withProjectName("Aurora CLI")
    .addService(new RuntimeKernelService())
    .build();

  try {
    await kernel.boot();
    kernel.start();

    const recovery =
      container.resolve<RecoveryService>(
        "RecoveryService"
      );

    await recovery.check();

    await program.parseAsync(process.argv);
  } finally {
    await kernel.shutdown();
  }
}

await main();
