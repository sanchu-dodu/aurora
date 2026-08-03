import test from "node:test";
import assert from "node:assert/strict";

import {
  ServiceCollection,
} from "../../dist/container/serviceCollection.js";

import {
  createContainer,
} from "../../dist/container/bootstrap/createContainer.js";

import {
  RuntimeManager,
} from "../../dist/runtime/runtimeManager.js";

import {
  PluginLoader,
} from "../../dist/runtime/pluginLoader.js";

import {
  RecoveryService,
} from "../../dist/packages/recovery/recoveryService.js";

class SingletonService {
  constructor() {
    this.createdAt =
      Symbol("singleton");
  }
}

class TransientService {
  constructor() {
    this.createdAt =
      Symbol("transient");
  }
}

test(
  "ServiceProvider preserves singleton identity",
  () => {
    const services =
      new ServiceCollection();

    services.addSingleton(
      "SingletonService",
      SingletonService
    );

    const provider =
      services.build();

    const first =
      provider.resolve(
        "SingletonService"
      );

    const second =
      provider.resolve(
        "SingletonService"
      );

    assert.strictEqual(
      first,
      second
    );
  }
);

test(
  "ServiceProvider creates a new transient instance for each resolution",
  () => {
    const services =
      new ServiceCollection();

    services.addTransient(
      "TransientService",
      TransientService
    );

    const provider =
      services.build();

    const first =
      provider.resolve(
        "TransientService"
      );

    const second =
      provider.resolve(
        "TransientService"
      );

    assert.notStrictEqual(
      first,
      second
    );
  }
);

test(
  "ServiceCollection rejects duplicate service tokens",
  () => {
    const services =
      new ServiceCollection();

    services.addSingleton(
      "DuplicateService",
      SingletonService
    );

    assert.throws(
      () => {
        services.addTransient(
          "DuplicateService",
          TransientService
        );
      },
      /already registered/
    );
  }
);

test(
  "Core services are registered as container singletons",
  () => {
    const container =
      createContainer();

    const runtimeManager =
      container.resolve(
        "RuntimeManager"
      );

    const pluginLoader =
      container.resolve(
        "PluginLoader"
      );

    const recoveryService =
      container.resolve(
        "RecoveryService"
      );

    assert.ok(
      runtimeManager instanceof
      RuntimeManager
    );

    assert.ok(
      pluginLoader instanceof
      PluginLoader
    );

    assert.ok(
      recoveryService instanceof
      RecoveryService
    );

    assert.strictEqual(
      runtimeManager,
      container.resolve(
        "RuntimeManager"
      )
    );

    assert.strictEqual(
      pluginLoader,
      container.resolve(
        "PluginLoader"
      )
    );

    assert.strictEqual(
      recoveryService,
      container.resolve(
        "RecoveryService"
      )
    );
  }
);

