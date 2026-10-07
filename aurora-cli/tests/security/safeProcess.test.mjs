import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  symlink,
  realpath,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
  dirname,
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

async function isolationFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aurora-executable-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const cwd = join(root, "probe");
  await mkdir(project);
  await mkdir(cwd);
  return { root, project, cwd };
}

/** A genuine executable/shim that records execution rather than merely throwing. */
async function markerCommand(directory, command, marker, script = join(directory, `${command}-entry.cjs`)) {
  await mkdir(directory, { recursive: true });
  const content = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\nprocess.stdout.write("1.0.0\\n");\n`;
  await writeFile(script, content);
  const executable = join(directory, process.platform === "win32" ? `${command}.cmd` : command);
  if (process.platform === "win32") {
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    await writeFile(executable, `#!${process.execPath}\n${content}`);
    await chmod(executable, 0o700);
  }
  return executable;
}

async function assertMarkerAbsent(marker) {
  await assert.rejects(readFile(marker), { code: "ENOENT" });
}

function isolationError(error) {
  assert.ok([ErrorCodes.UNSAFE_PROCESS_REQUEST, ErrorCodes.PROCESS_EXECUTION_FAILED].includes(error.code),
    `Unexpected executable-isolation error: ${error.code}`);
  return true;
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

test("Safe process carries diagnostic tool-probe restrictions explicitly", async () => {
  const environment = {
    COREPACK_ENABLE_NETWORK: "0", COREPACK_ENABLE_AUTO_PIN: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "0", COREPACK_ENV_FILE: "0", YARN_IGNORE_PATH: "1",
  };
  const result = await runProcess({
    command: "node",
    args: ["-e", "console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('COREPACK_') || k === 'YARN_IGNORE_PATH'))))"],
    environment,
  });
  assert.deepEqual(JSON.parse(result.stdout), environment);
});

for (const command of ["git", "npm", "pnpm"]) {
  test(`Diagnostic isolation does not execute a project-local ${command} command`, async t => {
    const { project, cwd } = await isolationFixture(t);
    const bins = join(project, "node_modules", ".bin");
    const marker = join(project, `${command}-executed.txt`);
    await markerCommand(bins, command, marker);
    await assert.rejects(runProcess({ command, args: ["--version"], cwd,
      environment: { PATH: bins }, excludedExecutableRoot: project }), isolationError);
    await assertMarkerAbsent(marker);
  });
}

test("Diagnostic isolation rejects an outside executable resolving into the project", async t => {
  const { root, project, cwd } = await isolationFixture(t);
  const inside = join(project, "tools");
  const outside = join(root, "external-path");
  const marker = join(project, "outside-alias-executed.txt");
  const executable = await markerCommand(inside, "pnpm", marker);
  await mkdir(outside);
  if (process.platform === "win32") {
    // The shim itself is outside; its executable Node.js entrypoint is inside.
    await markerCommand(outside, "pnpm", marker, join(inside, "pnpm-entry.cjs"));
  } else {
    await symlink(executable, join(outside, "pnpm"));
  }
  await assert.rejects(runProcess({ command: "pnpm", args: ["--version"], cwd,
    environment: { PATH: outside }, excludedExecutableRoot: project }), isolationError);
  await assertMarkerAbsent(marker);
});

test("Diagnostic isolation ignores relative PATH entries even outside the excluded project", async t => {
  const { root, project, cwd } = await isolationFixture(t);
  const marker = join(root, "relative-command-executed.txt");
  await markerCommand(join(cwd, "relative-bin"), "pnpm", marker);
  const originalCwd = process.cwd();
  process.chdir(cwd);
  try {
    await assert.rejects(runProcess({ command: "pnpm", args: ["--version"], cwd,
      environment: { PATH: "relative-bin" }, excludedExecutableRoot: project }), isolationError);
  } finally {
    process.chdir(originalCwd);
  }
  await assertMarkerAbsent(marker);
});

test("Diagnostic isolation rejects the current Node binary when it is inside the excluded root", async t => {
  const { root, cwd } = await isolationFixture(t);
  const marker = join(root, "current-node-executed.txt");
  await assert.rejects(runProcess({ command: "node", cwd,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")`],
    excludedExecutableRoot: dirname(await realpath(process.execPath)) }), isolationError);
  await assertMarkerAbsent(marker);
});

test("Trusted PATH behavior remains available without diagnostic exclusion", async t => {
  const { project, cwd } = await isolationFixture(t);
  const bins = join(project, "node_modules", ".bin");
  const marker = join(project, "trusted-command-executed.txt");
  await markerCommand(bins, "pnpm", marker);
  const result = await runProcess({ command: "pnpm", args: ["--version"], cwd,
    environment: { PATH: bins } });
  assert.equal(result.exitCode, 0);
  assert.equal(await readFile(marker, "utf8"), "executed");
});

test("Diagnostic isolation still permits trusted outside executables with a shared root-name prefix", async t => {
  const { root, project, cwd } = await isolationFixture(t);
  const bins = join(root, "project-tools");
  const marker = join(root, "outside-command-executed.txt");
  await markerCommand(bins, "pnpm", marker);
  const result = await runProcess({ command: "pnpm", args: ["--version"], cwd,
    environment: { PATH: bins }, excludedExecutableRoot: project });
  assert.equal(result.exitCode, 0);
  assert.equal(await readFile(marker, "utf8"), "executed");
});

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
