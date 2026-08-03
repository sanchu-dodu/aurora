import test from "node:test";
import assert from "node:assert/strict";

import {
  PluginRunner,
} from "../../dist/runtime/pluginRunner.js";

function createPlugin(
  id,
  events,
  options = {}
) {
  return {
    id,
    name: options.name ?? id,
    version: "1.0.0",

    async activate() {
      events.push(`activate:${id}`);

      if (options.failActivate) {
        throw new Error(
          `${id} activation failed`
        );
      }
    },

    async deactivate() {
      events.push(`deactivate:${id}`);

      if (options.failDeactivate) {
        throw new Error(
          `${id} deactivation failed`
        );
      }
    },
  };
}

test(
  "PluginRunner activates plugins in order and stops them in reverse order",
  async () => {
    const events = [];

    const plugins = [
      createPlugin("first", events),
      createPlugin("second", events),
    ];

    const runner =
      new PluginRunner(() => plugins);

    await runner.start();

    assert.equal(
      runner.isStarted,
      true
    );

    assert.deepEqual(
      events,
      [
        "activate:first",
        "activate:second",
      ]
    );

    await runner.stop();

    assert.equal(
      runner.isStarted,
      false
    );

    assert.deepEqual(
      events,
      [
        "activate:first",
        "activate:second",
        "deactivate:second",
        "deactivate:first",
      ]
    );
  }
);

test(
  "PluginRunner rolls back activated plugins when activation fails",
  async () => {
    const events = [];

    const plugins = [
      createPlugin("first", events),
      createPlugin(
        "second",
        events,
        {
          failActivate: true,
        }
      ),
      createPlugin("third", events),
    ];

    const runner =
      new PluginRunner(() => plugins);

    await assert.rejects(
      runner.start(),
      /second activation failed/
    );

    assert.equal(
      runner.isStarted,
      false
    );

    assert.deepEqual(
      events,
      [
        "activate:first",
        "activate:second",
        "deactivate:first",
      ]
    );
  }
);

test(
  "PluginRunner attempts every shutdown and aggregates failures",
  async () => {
    const events = [];

    const plugins = [
      createPlugin(
        "first",
        events,
        {
          failDeactivate: true,
        }
      ),
      createPlugin("second", events),
      createPlugin(
        "third",
        events,
        {
          failDeactivate: true,
        }
      ),
    ];

    const runner =
      new PluginRunner(() => plugins);

    await runner.start();

    await assert.rejects(
      runner.stop(),
      (error) => {
        assert.equal(
          error instanceof AggregateError,
          true
        );

        assert.equal(
          error.errors.length,
          2
        );

        assert.match(
          error.message,
          /runtime plugins failed to stop/
        );

        return true;
      }
    );

    assert.equal(
      runner.isStarted,
      false
    );

    assert.deepEqual(
      events,
      [
        "activate:first",
        "activate:second",
        "activate:third",
        "deactivate:third",
        "deactivate:second",
        "deactivate:first",
      ]
    );
  }
);

test(
  "PluginRunner start and stop operations are idempotent",
  async () => {
    const events = [];

    const plugins = [
      createPlugin("only", events),
    ];

    const runner =
      new PluginRunner(() => plugins);

    await runner.start();
    await runner.start();

    await runner.stop();
    await runner.stop();

    assert.deepEqual(
      events,
      [
        "activate:only",
        "deactivate:only",
      ]
    );

    assert.equal(
      runner.isStarted,
      false
    );
  }
);
