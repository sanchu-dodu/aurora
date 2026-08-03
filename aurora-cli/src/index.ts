#!/usr/bin/env node
import {
  Command,
  CommanderError,
} from "commander";

import {
  showBanner,
} from "./utils/banner.js";

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
import "./templates/registerNext.js";

import {
  registerAllCommands,
} from "./core/commandRegistry.js";

import {
  discoverTemplates,
} from "./templates/registry/templateRegistry.js";

import {
  discoverPackages,
} from "./packages/discovery/packageDiscovery.js";

import {
  discoverManifests,
} from "./packages/discovery/discoverManifests.js";

import {
  registerAllGenerators,
} from "./generator/registry/registerGenerators.js";

import {
  RecoveryService,
} from "./packages/recovery/recoveryService.js";

import {
  KernelBuilder,
} from "./kernel/kernelBuilder.js";

import {
  RuntimeKernelService,
} from "./runtime/runtimeKernelService.js";

import {
  PluginLoader,
} from "./runtime/pluginLoader.js";

import {
  RuntimeManager,
} from "./runtime/runtimeManager.js";

import {
  container,
} from "./container/bootstrap/containerBootstrap.js";

import {
  formatFatalError,
} from "./errors/formatError.js";

const program =
  new Command();

program
  .name("aurora")
  .description(
    "Aurora Command Line Interface"
  )
  .version("0.1.0");

program.exitOverride();

program.action(() => {
  console.log(
    "Aurora CLI started successfully."
  );
});

async function main():
  Promise<void> {
  showBanner();

  registerAllCommands(
    program
  );

  await discoverTemplates();
  await discoverPackages();

  registerAllGenerators();

  await discoverManifests();

  const pluginLoader =
    container.resolve<PluginLoader>(
      "PluginLoader"
    );

  const runtimeManager =
    container.resolve<RuntimeManager>(
      "RuntimeManager"
    );

  const kernel =
    new KernelBuilder()
      .withWorkspace(
        process.cwd()
      )
      .withProjectName(
        "Aurora CLI"
      )
      .addService(
        new RuntimeKernelService(
          pluginLoader,
          runtimeManager
        )
      )
      .build();

  let operationError:
    unknown;

  try {
    await kernel.boot();

    kernel.start();

    const recovery =
      container.resolve<RecoveryService>(
        "RecoveryService"
      );

    await recovery.check();

    await program.parseAsync(
      process.argv
    );
  } catch (error) {
    const successfulCommanderExit =
      error instanceof
        CommanderError &&
      error.exitCode === 0;

    if (
      !successfulCommanderExit
    ) {
      operationError =
        error;
    }
  }

  try {
    await kernel.shutdown();
  } catch (shutdownError) {
    if (operationError) {
      throw new AggregateError(
        [
          operationError,
          shutdownError,
        ],
        "The CLI operation and Kernel shutdown both failed."
      );
    }

    throw shutdownError;
  }

  if (operationError) {
    throw operationError;
  }
}

function handleFatalError(
  error: unknown
): void {
  if (
    error instanceof
    CommanderError
  ) {
    process.exitCode =
      error.exitCode;

    return;
  }

  console.error(
    formatFatalError(error)
  );

  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  handleFatalError(error);
}