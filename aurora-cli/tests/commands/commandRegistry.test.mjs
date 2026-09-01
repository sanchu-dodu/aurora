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
  "Command registry applies conservative top-level activation defaults",
  () => {
    const expectedActivations = {
      apply: "none",
      completion: "none",
      config: "none",
      doctor: "none",
      feature: "runtime",
      generate: "runtime",
      init: "runtime",
      list: "catalog",
      package: "runtime",
      plan: "none",
      plugin: "catalog",
      recovery: "runtime",
      template: "runtime",
    };

    for (
      const commandId
      of expectedTopLevelCommands
    ) {
      assert.equal(
        getCommandActivation(
          commandId
        ),
        expectedActivations[
          commandId
        ]
      );
    }

    assert.equal(
      getCommandActivation(
        "not-registered"
      ),
      "runtime"
    );
  }
);

test(
  "Read-only mixed subcommands use none or catalog while mutations stay runtime",
  () => {
    const readOnlyPolicies = [
      [
        "template",
        ["info"],
        "catalog",
      ],
      [
        "template",
        ["search"],
        "catalog",
      ],
      [
        "feature",
        ["installed"],
        "none",
      ],
      [
        "feature",
        ["list"],
        "catalog",
      ],
      [
        "generate",
        ["list"],
        "catalog",
      ],
      [
        "package",
        ["info"],
        "catalog",
      ],
      [
        "package",
        ["list"],
        "catalog",
      ],
      [
        "package",
        ["manifest"],
        "catalog",
      ],
      [
        "package",
        ["resolve"],
        "catalog",
      ],
      [
        "package",
        ["search"],
        "catalog",
      ],
      [
        "package",
        ["tree"],
        "catalog",
      ],
      [
        "package",
        ["verify"],
        "catalog",
      ],
      [
        "recovery",
        ["list"],
        "none",
      ],
    ];

    for (
      const [
        commandId,
        path,
        expectedActivation,
      ] of readOnlyPolicies
    ) {
      assert.equal(
        getCommandActivation(
          commandId,
          path
        ),
        expectedActivation,
        `${commandId} ${path.join(" ")}`
      );
    }

    const mutationPolicies = [
      [
        "template",
        ["install"],
      ],
      [
        "feature",
        ["install"],
      ],
      [
        "generate",
        ["component"],
      ],
      [
        "package",
        ["install"],
      ],
      [
        "package",
        ["update"],
      ],
      [
        "package",
        ["uninstall"],
      ],
      [
        "package",
        ["repair"],
      ],
      [
        "package",
        ["publish"],
      ],
      [
        "package",
        ["activate-release"],
      ],
      [
        "package",
        ["finalize-release"],
      ],
      [
        "package",
        ["propose-release"],
      ],
      [
        "recovery",
        ["rollback"],
      ],
    ];

    for (
      const [
        commandId,
        path,
      ] of mutationPolicies
    ) {
      assert.equal(
        getCommandActivation(
          commandId,
          path
        ),
        "runtime",
        `${commandId} ${path.join(" ")}`
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
        "activate-release",
        "finalize-release",
        "info",
        "install",
        "list",
        "manifest",
        "publish",
        "propose-release",
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
