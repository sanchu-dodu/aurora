import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  runProcess,
} from "../../dist/services/processService.js";

import {
  installDependencies,
} from "../../dist/services/installer.js";

function hasCode(code) {
  return error => {
    assert.equal(
      error.code,
      code
    );

    return true;
  };
}

test(
  "Safe process executes allowlisted commands with captured output",
  async () => {
    const result =
      await runProcess({
        command: "node",
        args: [
          "-e",
          "process.stdout.write('safe-output')",
        ],
      });

    assert.equal(
      result.exitCode,
      0
    );

    assert.equal(
      result.stdout,
      "safe-output"
    );

    assert.equal(
      result.stderr,
      ""
    );
  }
);

test(
  "Safe process resolves npm without shell-string execution",
  async () => {
    const result =
      await runProcess({
        command: "npm",
        args: [
          "--version",
        ],
      });

    assert.equal(
      result.exitCode,
      0
    );

    assert.match(
      result.stdout,
      /^\d+\.\d+\.\d+/u
    );
  }
);

test(
  "Safe process rejects command, argument, and environment injection",
  async () => {
    await assert.rejects(
      runProcess({
        command:
          "node & echo unsafe",
        args: [],
      }),
      hasCode(
        ErrorCodes
          .UNSAFE_PROCESS_REQUEST
      )
    );

    await assert.rejects(
      runProcess({
        command: "node",
        args: [
          "unsafe\nargument",
        ],
      }),
      hasCode(
        ErrorCodes
          .UNSAFE_PROCESS_REQUEST
      )
    );

    await assert.rejects(
      runProcess({
        command: "node",
        args: [
          "--version",
        ],
        environment: {
          NODE_OPTIONS:
            "--require=unsafe.js",
        },
      }),
      hasCode(
        ErrorCodes
          .UNSAFE_PROCESS_REQUEST
      )
    );
  }
);

test(
  "Safe process redacts secrets and URL credentials from captured output",
  async () => {
    const secret =
      "aurora-test-secret";

    const result =
      await runProcess({
        command: "node",
        args: [
          "-e",
          "process.stdout.write(`${process.env.NPM_TOKEN} https://user:password@example.com/private`)",
        ],
        environment: {
          NPM_TOKEN: secret,
        },
      });

    assert.equal(
      result.stdout,
      "[REDACTED] https://[REDACTED]@example.com/private"
    );

    assert.equal(
      result.stdout.includes(secret),
      false
    );
  }
);

test(
  "Safe process enforces timeout and cancellation",
  async () => {
    await assert.rejects(
      runProcess({
        command: "node",
        args: [
          "-e",
          "setTimeout(() => {}, 10_000)",
        ],
        timeoutMs: 50,
      }),
      hasCode(
        ErrorCodes.PROCESS_TIMEOUT
      )
    );

    const controller =
      new AbortController();

    controller.abort();

    await assert.rejects(
      runProcess({
        command: "node",
        args: [
          "--version",
        ],
        signal:
          controller.signal,
      }),
      hasCode(
        ErrorCodes.PROCESS_ABORTED
      )
    );
  }
);

test(
  "Safe process enforces its captured-output limit",
  async () => {
    await assert.rejects(
      runProcess({
        command: "node",
        args: [
          "-e",
          "process.stdout.write('x'.repeat(4096))",
        ],
        maxOutputBytes: 128,
      }),
      hasCode(
        ErrorCodes
          .PROCESS_OUTPUT_LIMIT
      )
    );
  }
);

test(
  "Dependency installation uses a canonical project root and an allowlisted manager",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-installer-"
        )
      );

    const commands = [];

    try {
      await installDependencies(
        projectRoot,
        "npm",
        async (
          command,
          args,
          cwd
        ) => {
          commands.push({
            command,
            args,
            cwd,
          });
        }
      );

      assert.deepEqual(
        commands,
        [
          {
            command: "npm",
            args: [
              "install",
            ],
            cwd:
              await realpath(
                projectRoot
              ),
          },
        ]
      );

      await assert.rejects(
        installDependencies(
          projectRoot,
          "npm && unsafe",
          async () => {
            throw new Error(
              "Runner should not be called."
            );
          }
        ),
        /Unsupported package manager/
      );
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
