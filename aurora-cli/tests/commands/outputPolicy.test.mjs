import test from "node:test";
import assert from "node:assert/strict";

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
  applyCliOutputPolicy,
  resolveCliOutputOptions,
} from "../../dist/core/outputPolicy.js";

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

test(
  "global output options are resolved before command activation",
  () => {
    assert.deepEqual(
      resolveCliOutputOptions([
        "node",
        "aurora",
        "config",
        "list",
        "--quiet",
        "--no-color",
      ]),
      {
        color: false,
        quiet: true,
      }
    );

    assert.deepEqual(
      resolveCliOutputOptions([
        "node",
        "aurora",
        "--quiet",
        "--",
        "--no-color",
      ]),
      {
        color: true,
        quiet: true,
      }
    );
  }
);

test(
  "output policy suppresses stdout, preserves stderr, strips styling, and restores streams",
  () => {
    const originalStdout =
      process.stdout.write;
    const originalStderr =
      process.stderr.write;
    let stdout = "";
    let stderr = "";

    const captureStdout =
      function (chunk) {
        stdout += chunk.toString();
        return true;
      };

    const captureStderr =
      function (chunk) {
        stderr += chunk.toString();
        return true;
      };

    process.stdout.write =
      captureStdout;
    process.stderr.write =
      captureStderr;

    try {
      const policy =
        applyCliOutputPolicy({
          color: false,
          quiet: true,
        });

      process.stdout.write(
        "\u001B[31mnormal\u001B[39m"
      );
      process.stderr.write(
        "\u001B[31mfailure\u001B[39m"
      );

      assert.equal(stdout, "");
      assert.equal(stderr, "failure");

      policy.restore();

      assert.equal(
        process.stdout.write,
        captureStdout
      );
      assert.equal(
        process.stderr.write,
        captureStderr
      );
    } finally {
      process.stdout.write =
        originalStdout;
      process.stderr.write =
        originalStderr;
    }
  }
);

test(
  "quiet applies globally and does not hide command failures",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-output-policy-"
        )
      );

    try {
      const configDirectory =
        join(
          workspaceRoot,
          ".aurora"
        );

      await mkdir(
        configDirectory,
        {
          recursive: true,
        }
      );

      await writeFile(
        join(
          configDirectory,
          "config.json"
        ),
        `${JSON.stringify({
          defaultFramework: "nextjs",
          initializeGit: true,
          installDependencies: true,
          language: "typescript",
          packageManager: "npm",
        })}\n`,
        "utf8"
      );

      for (
        const args
        of [
          [
            "--quiet",
            "config",
            "list",
          ],
          [
            "config",
            "list",
            "--quiet",
          ],
        ]
      ) {
        const result =
          await runCli(
            args,
            workspaceRoot,
            {
              FORCE_COLOR: "3",
            }
          );

        assert.equal(
          result.code,
          0,
          JSON.stringify(result)
        );
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }

      const failed =
        await runCli(
          [
            "--quiet",
            "config",
            "get",
            "unknownKey",
          ],
          workspaceRoot,
          {
            FORCE_COLOR: "3",
          }
        );

      assert.equal(failed.code, 1);
      assert.equal(failed.stdout, "");
      assert.match(
        failed.stderr,
        /Aurora CLI failed/
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
  "no-color strips styling from normal output and failures",
  async () => {
    const workspaceRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-no-color-"
        )
      );

    try {
      const success =
        await runCli(
          [
            "doctor",
            "--no-color",
          ],
          workspaceRoot,
          {
            FORCE_COLOR: "3",
          }
        );

      assert.equal(success.code, 0);
      assert.doesNotMatch(
        success.stdout,
        /\u001B\[/
      );
      assert.doesNotMatch(
        success.stderr,
        /\u001B\[/
      );

      const failed =
        await runCli(
          [
            "--no-color",
            "config",
            "get",
            "unknownKey",
          ],
          workspaceRoot,
          {
            FORCE_COLOR: "3",
          }
        );

      assert.equal(failed.code, 1);
      assert.match(
        failed.stderr,
        /Aurora CLI failed/
      );
      assert.doesNotMatch(
        failed.stderr,
        /\u001B\[/
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

function runCli(
  args,
  cwd,
  environment = {}
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
            ...environment,
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
        chunk => {
          stdout += chunk;
        }
      );
      child.stderr.on(
        "data",
        chunk => {
          stderr += chunk;
        }
      );
      child.once("error", reject);
      child.once(
        "close",
        (code, signal) => {
          resolve({
            code,
            signal,
            stderr,
            stdout,
          });
        }
      );
    }
  );
}
