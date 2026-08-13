import test from "node:test";
import assert from "node:assert/strict";

import { Command } from "commander";

import "../../dist/commands/initRegistration.js";
import "../../dist/commands/doctorRegistration.js";
import "../../dist/commands/listRegistration.js";
import "../../dist/commands/pluginRegistration.js";
import "../../dist/commands/configRegistration.js";
import "../../dist/commands/templateRegistration.js";
import "../../dist/commands/featureRegistration.js";
import "../../dist/commands/generateRegistration.js";
import "../../dist/commands/packageRegistration.js";
import "../../dist/commands/recoveryRegistration.js";
import "../../dist/commands/completionRegistration.js";
import "../../dist/commands/planApplyRegistration.js";

import {
  getCommandActivation,
  getRegisteredCommandIds,
  registerAllCommands,
  registerCommand,
} from "../../dist/core/commandRegistry.js";

const expectedTopLevelCommands = [
  "apply",
  "completion",
  "config",
  "doctor",
  "feature",
  "generate",
  "init",
  "list",
  "package",
  "plan",
  "plugin",
  "recovery",
  "template",
];

function createProgram() {
  const program = new Command();

  program
    .name("aurora")
    .exitOverride();

  registerAllCommands(program);

  return program;
}

function getCommand(
  parent,
  commandName
) {
  const command =
    parent.commands.find(
      (candidate) =>
        candidate.name() === commandName
    );

  assert.ok(
    command,
    `Expected command '${commandName}' to exist.`
  );

  return command;
}

test(
  "Command registry contains every Aurora top-level command",
  () => {
    assert.deepEqual(
      getRegisteredCommandIds().sort(),
      expectedTopLevelCommands
    );
  }
);

test(
  "Planning commands bypass runtime activation",
  () => {
    const passiveCommands =
      new Set([
        "apply",
        "completion",
        "config",
        "plan",
      ]);

    for (
      const commandId
      of expectedTopLevelCommands
    ) {
      assert.equal(
        getCommandActivation(
          commandId
        ),
        passiveCommands.has(
          commandId
        )
          ? "none"
          : "runtime"
      );
    }
  }
);

test(
  "Command registry builds a unique top-level command tree",
  () => {
    const program = createProgram();

    const commandNames =
      program.commands
        .map((command) => command.name())
        .sort();

    assert.deepEqual(
      commandNames,
      expectedTopLevelCommands
    );

    assert.equal(
      new Set(commandNames).size,
      commandNames.length
    );
  }
);

test(
  "Command tree contains the expected nested commands",
  () => {
    const program = createProgram();

    const expectedSubcommands = {
      config: [
        "get",
        "list",
        "set",
      ],

      template: [
        "info",
        "install",
        "search",
      ],

      feature: [
        "install",
        "installed",
        "list",
      ],

      generate: [
        "component",
        "list",
      ],

      package: [
        "info",
        "install",
        "list",
        "manifest",
        "publish",
        "repair",
        "resolve",
        "search",
        "tree",
        "uninstall",
        "update",
        "verify",
      ],

      recovery: [
        "list",
        "rollback",
      ],

      plan: [
        "config",
      ],
    };

    for (
      const [
        parentName,
        expectedChildren,
      ] of Object.entries(
        expectedSubcommands
      )
    ) {
      const parent =
        getCommand(
          program,
          parentName
        );

      const actualChildren =
        parent.commands
          .map(
            (command) =>
              command.name()
          )
          .sort();

      assert.deepEqual(
        actualChildren,
        [...expectedChildren].sort()
      );
    }
  }
);

test(
  "Command registry rejects duplicate identifiers",
  () => {
    assert.throws(
      () => {
        registerCommand({
          id: "init",

          register() {
            // Duplicate registration must not execute.
          },
        });
      },
      /already registered/
    );
  }
);
