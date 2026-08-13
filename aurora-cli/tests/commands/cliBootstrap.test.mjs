import test from "node:test";
import assert from "node:assert/strict";

import {
  Command,
} from "commander";

import {
  spawn,
} from "node:child_process";

import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  COMPLETION_SHELLS,
  generateCompletionScript,
} from "../../dist/services/completion.js";

import "../../dist/commands/templateRegistration.js";

import {
  runCli as executeCli,
} from "../../dist/cli.js";

import {
  AuroraCliActivation,
} from "../../dist/runtime/cliActivation.js";

const cliRoot =
  fileURLToPath(
    new URL(
      "../../",
      import.meta.url
    )
  );

const cliEntry =
  join(
    cliRoot,
    "dist",
    "index.js"
  );

function runCli(
  args,
  cwd
) {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cliEntry,
          ...args,
        ],
        {
          cwd,
          windowsHide: true,
          env: {
            ...process.env,
            FORCE_COLOR: "0",
          },
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding(
        "utf8"
      );

      child.stderr.setEncoding(
        "utf8"
      );

      child.stdout.on(
        "data",
        (chunk) => {
          stdout += chunk;
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr += chunk;
        }
      );

      child.once(
        "error",
        reject
      );

      child.once(
        "close",
        (code, signal) => {
          resolve({
            code,
            signal,
            stdout,
            stderr,
          });
        }
      );
    }
  );
}

function assertNoActivation(
  result
) {
  const output =
    `${result.stdout}\n${result.stderr}`;

  assert.doesNotMatch(
    output,
    /PACKAGE_ACTIVATION_TRIPWIRE/
  );

  assert.doesNotMatch(
    output,
    /Aurora Runtime/
  );

  assert.doesNotMatch(
    output,
    /plugin activated/i
  );

  assert.doesNotMatch(
    output,
    /Discovered \d+ plugin file/
  );

  assert.doesNotMatch(
    output,
    /The command center for Aurora/
  );
}

test(
  "Completion setup is generated for every supported shell",
  () => {
    const program =
      new Command()
        .name("aurora");

    program
      .command("doctor");

    program
      .command("package")
      .command("list");

    const expectedMarkers = {
      bash:
        "complete -F _aurora_completion aurora",

      zsh:
        "compdef _aurora aurora",

      fish:
        "complete -c aurora",

      powershell:
        "Register-ArgumentCompleter",
    };

    for (const shell of COMPLETION_SHELLS) {
      const script =
        generateCompletionScript(
          program,
          shell
        );

      assert.match(
        script,
        new RegExp(
          expectedMarkers[shell]
            .replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )
        )
      );

      assert.match(
        script,
        /package/
      );

      assert.match(
        script,
        /list/
      );
    }
  }
);

test(
  "CLI parses passive and rejected invocations before activation",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-bootstrap-"
        )
      );

    const packagesRoot =
      join(
        workspaceRoot,
        "activation-packages"
      );

    const tripwirePackageRoot =
      join(
        packagesRoot,
        "activation-tripwire"
      );

    try {
      await mkdir(
        tripwirePackageRoot,
        {
          recursive: true,
        }
      );

      await writeFile(
        join(
          tripwirePackageRoot,
          "manifest.json"
        ),
        `${JSON.stringify({
          manifestVersion: 1,
          kind: "package",
          id: "activation-tripwire",
          PACKAGE_ACTIVATION_TRIPWIRE: true,
        })}\n`,
        "utf8"
      );

      const help =
        await runCli(
          [
            "--help",
          ],
          workspaceRoot
        );

      assert.equal(
        help.code,
        0
      );

      assert.match(
        help.stdout,
        /Usage:\s+aurora/i
      );

      assertNoActivation(help);

      const helpCommand =
        await runCli(
          [
            "help",
          ],
          workspaceRoot
        );

      assert.equal(
        helpCommand.code,
        0
      );

      assert.match(
        helpCommand.stdout,
        /Usage:\s+aurora/i
      );

      assertNoActivation(
        helpCommand
      );

      const nestedHelp =
        await runCli(
          [
            "package",
            "--help",
          ],
          workspaceRoot
        );

      assert.equal(
        nestedHelp.code,
        0
      );

      assert.match(
        nestedHelp.stdout,
        /Usage:\s+aurora package/i
      );

      assertNoActivation(
        nestedHelp
      );

      const nestedHelpCommand =
        await runCli(
          [
            "package",
            "help",
          ],
          workspaceRoot
        );

      assert.equal(
        nestedHelpCommand.code,
        0
      );

      assert.match(
        nestedHelpCommand.stdout,
        /Usage:\s+aurora package/i
      );

      assertNoActivation(
        nestedHelpCommand
      );

      const version =
        await runCli(
          [
            "--version",
          ],
          workspaceRoot
        );

      assert.equal(
        version.code,
        0
      );

      assertNoActivation(
        version
      );

      const completion =
        await runCli(
          [
            "completion",
            "powershell",
          ],
          workspaceRoot
        );

      assert.equal(
        completion.code,
        0
      );

      assert.match(
        completion.stdout,
        /Register-ArgumentCompleter/
      );

      assert.match(
        completion.stdout,
        /"package"/
      );

      assertNoActivation(
        completion
      );

      const invalidCompletion =
        await runCli(
          [
            "completion",
            "unsupported-shell",
          ],
          workspaceRoot
        );

      assert.equal(
        invalidCompletion.code,
        1
      );

      assert.match(
        invalidCompletion.stderr,
        /allowed choices/i
      );

      assertNoActivation(
        invalidCompletion
      );

      const unknownOption =
        await runCli(
          [
            "--activation-must-not-run",
          ],
          workspaceRoot
        );

      assert.equal(
        unknownOption.code,
        1
      );

      assert.match(
        unknownOption.stderr,
        /unknown option/i
      );

      assertNoActivation(
        unknownOption
      );

      const missingArgument =
        await runCli(
          [
            "template",
            "info",
          ],
          workspaceRoot
        );

      assert.equal(
        missingArgument.code,
        1
      );

      assert.match(
        missingArgument.stderr,
        /missing required argument/i
      );

      assertNoActivation(
        missingArgument
      );

      await assert.rejects(
        executeCli(
          [
            process.execPath,
            "aurora",
            "template",
            "search",
            "anything",
          ],
          new AuroraCliActivation({
            packageRoot:
              packagesRoot,
          })
        ),
        /PACKAGE_ACTIVATION_TRIPWIRE/
      );
    } finally {
      await rm(
        workspaceRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
