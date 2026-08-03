import {
  AURORA_CLI_METADATA,
} from "../../dist/core/packageMetadata.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  spawn,
} from "node:child_process";

import {
  access,
  mkdtemp,
  rm,
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
  runDoctor,
} from "../../dist/services/doctor.js";

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
  cwd = cliRoot
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

async function exists(
  targetPath
) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

test(
  "CLI version exits successfully",
  async () => {
    const result =
      await runCli([
        "--version",
      ]);

    assert.equal(
      result.code,
      0
    );

    assert.equal(
      result.signal,
      null
    );

    const outputLines =
      result.stdout
        .split(/\r?\n/)
        .map(
          (line) =>
            line.trim()
        );

    assert.ok(
      outputLines.includes(
        AURORA_CLI_METADATA.version
      ),
      `Expected --version output to contain '${AURORA_CLI_METADATA.version}'.`
    );
  }
);

test(
  "Template search with no matches remains successful",
  async () => {
    const result =
      await runCli([
        "template",
        "search",
        "__definitely_missing_template__",
      ]);

    assert.equal(
      result.code,
      0
    );

    assert.match(
      result.stdout,
      /No templates found\./
    );
  }
);

test(
  "Missing template information exits with failure",
  async () => {
    const result =
      await runCli([
        "template",
        "info",
        "__missing_template__",
      ]);

    assert.equal(
      result.code,
      1
    );

    assert.match(
      result.stderr,
      /Template '__missing_template__' not found/
    );

    assert.match(
      result.stderr,
      /Code: TEMPLATE_NOT_FOUND/
    );
  }
);

test(
  "Missing template installation exits with failure and creates no project",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-exit-template-"
        )
      );

    try {
      const result =
        await runCli(
          [
            "template",
            "install",
            "__missing_template__",
            "should-not-exist",
          ],
          workspaceRoot
        );

      assert.equal(
        result.code,
        1
      );

      assert.match(
        result.stderr,
        /Template '__missing_template__' not found/
      );

      assert.match(
        result.stderr,
        /Code: TEMPLATE_NOT_FOUND/
      );

      assert.equal(
        await exists(
          join(
            workspaceRoot,
            "should-not-exist"
          )
        ),
        false
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

test(
  "Unknown plugin actions exit with failure",
  async () => {
    const result =
      await runCli([
        "plugin",
        "__unknown_action__",
      ]);

    assert.equal(
      result.code,
      1
    );

    assert.match(
      result.stderr,
      /Unknown plugin action '__unknown_action__'/
    );

    assert.match(
      result.stderr,
      /Code: UNKNOWN_PLUGIN_ACTION/
    );
  }
);

test(
  "Unknown configuration keys exit with failure",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-exit-config-"
        )
      );

    try {
      const result =
        await runCli(
          [
            "config",
            "get",
            "__unknown_key__",
          ],
          workspaceRoot
        );

      assert.equal(
        result.code,
        1
      );

      assert.match(
        result.stderr,
        /Unknown configuration key '__unknown_key__'/
      );

      assert.match(
        result.stderr,
        /Code: UNKNOWN_CONFIGURATION_KEY/
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

test(
  "Doctor throws after reporting failed environment checks",
  async () => {
    const receivedCommands = [];

    await assert.rejects(
      () =>
        runDoctor(
          async (command) => {
            receivedCommands.push(
              command
            );

            return command !==
              "npm --version";
          }
        ),
      /Doctor checks failed: npm/
    );

    assert.deepEqual(
      receivedCommands,
      [
        "git --version",
        "node --version",
        "npm --version",
      ]
    );
  }
);