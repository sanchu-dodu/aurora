import test from "node:test";
import assert from "node:assert/strict";

import { KernelBuilder } from "../../dist/kernel/kernelBuilder.js";
import { KernelState } from "../../dist/kernel/kernelLifecycle.js";

function createService(
  id,
  events,
  options = {}
) {
  return {
    id,

    async initialize() {
      events.push(`initialize:${id}`);

      if (options.failInitialize) {
        throw new Error(
          options.failureMessage ?? `${id} initialization failed`
        );
      }
    },

    async shutdown() {
      events.push(`shutdown:${id}`);

      if (options.failShutdown) {
        throw new Error(
          options.failureMessage ?? `${id} shutdown failed`
        );
      }
    },
  };
}

test(
  "Kernel boots, starts, and shuts services down in reverse order",
  async () => {
    const events = [];

    const kernel = new KernelBuilder()
      .withProjectName("Kernel lifecycle test")
      .addService(createService("first", events))
      .addService(createService("second", events))
      .build();

    assert.equal(
      kernel.currentState,
      KernelState.Created
    );

    await kernel.boot();

    assert.equal(
      kernel.currentState,
      KernelState.Ready
    );

    kernel.start();

    assert.equal(
      kernel.currentState,
      KernelState.Running
    );

    await kernel.shutdown();

    assert.equal(
      kernel.currentState,
      KernelState.Stopped
    );

    assert.deepEqual(
      events,
      [
        "initialize:first",
        "initialize:second",
        "shutdown:second",
        "shutdown:first",
      ]
    );
  }
);

test(
  "Kernel rolls back initialized services when boot fails",
  async () => {
    const events = [];

    const kernel = new KernelBuilder()
      .withProjectName("Kernel rollback test")
      .addService(createService("healthy", events))
      .addService(
        createService(
          "failing",
          events,
          {
            failInitialize: true,
            failureMessage: "Expected boot failure",
          }
        )
      )
      .build();

    await assert.rejects(
      kernel.boot(),
      /Expected boot failure/
    );

    assert.equal(
      kernel.currentState,
      KernelState.Stopped
    );

    assert.deepEqual(
      events,
      [
        "initialize:healthy",
        "initialize:failing",
        "shutdown:healthy",
      ]
    );
  }
);

test(
  "KernelBuilder rejects duplicate service identifiers",
  () => {
    const events = [];

    const builder = new KernelBuilder()
      .addService(createService("duplicate", events));

    assert.throws(
      () => {
        builder.addService(
          createService("duplicate", events)
        );
      },
      /already registered/
    );
  }
);
