import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
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
  initializeGit,
} from "../../dist/services/git.js";

import {
  runProcess,
} from "../../dist/services/processService.js";

function processResult(
  request
) {
  return {
    command: request.command,
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
  };
}

function isUnsafeProjectPath(error) {
  assert.equal(
    error.code,
    ErrorCodes.UNSAFE_PROJECT_PATH
  );

  return true;
}

test(
  "Git initialization stages only explicit validated files",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-git-"
        )
      );

    const requests = [];

    try {
      await mkdir(
        join(projectRoot, "src")
      );

      await writeFile(
        join(
          projectRoot,
          "package.json"
        ),
        "{}\n",
        "utf8"
      );

      await writeFile(
        join(
          projectRoot,
          "src",
          "index.ts"
        ),
        "export {};\n",
        "utf8"
      );

      await initializeGit(
        projectRoot,
        [
          "src/index.ts",
          "package.json",
          "src/index.ts",
        ],
        async request => {
          requests.push(request);

          return processResult(
            request
          );
        }
      );

      const canonicalRoot =
        await realpath(projectRoot);

      assert.deepEqual(
        requests.map(
          request => ({
            command:
              request.command,
            args:
              request.args,
            cwd:
              request.cwd,
          })
        ),
        [
          {
            command: "git",
            args: [
              "init",
            ],
            cwd:
              canonicalRoot,
          },
          {
            command: "git",
            args: [
              "add",
              "--",
              "package.json",
              "src/index.ts",
            ],
            cwd:
              canonicalRoot,
          },
          {
            command: "git",
            args: [
              "commit",
              "-m",
              "Initial commit",
            ],
            cwd:
              canonicalRoot,
          },
        ]
      );

      assert.equal(
        requests.some(
          request =>
            request.args.includes(
              "."
            )
        ),
        false
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

test(
  "Git initialization leaves files outside Aurora's generated set untracked",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-git-real-"
        )
      );

    await writeFile(
      join(
        projectRoot,
        "generated.txt"
      ),
      "generated\n",
      "utf8"
    );

    await writeFile(
      join(
        projectRoot,
        "unowned.txt"
      ),
      "unowned\n",
      "utf8"
    );

    try {
      await runProcess({
        command: "git",
        args: [
          "init",
        ],
        cwd: projectRoot,
      });

      await runProcess({
        command: "git",
        args: [
          "config",
          "user.name",
          "Aurora Test",
        ],
        cwd: projectRoot,
      });

      await runProcess({
        command: "git",
        args: [
          "config",
          "user.email",
          "aurora@example.invalid",
        ],
        cwd: projectRoot,
      });

      await initializeGit(
        projectRoot,
        [
          "generated.txt",
        ]
      );

      const status =
        await runProcess({
          command: "git",
          args: [
            "status",
            "--porcelain",
          ],
          cwd: projectRoot,
        });

      assert.equal(
        status.stdout.trim(),
        "?? unowned.txt"
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

test(
  "Git initialization rejects traversal in the generated file list",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-git-traversal-"
        )
      );

    const requests = [];

    try {
      await assert.rejects(
        initializeGit(
          projectRoot,
          [
            "../outside.txt",
          ],
          async request => {
            requests.push(request);

            return processResult(
              request
            );
          }
        ),
        isUnsafeProjectPath
      );

      assert.equal(
        requests.length,
        0
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

test(
  "Git initialization rejects files reached through a symbolic link or junction",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-git-link-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const outsideRoot =
      join(sandbox, "outside");

    const linkPath =
      join(projectRoot, "linked");

    await mkdir(projectRoot);
    await mkdir(outsideRoot);

    try {
      await symlink(
        outsideRoot,
        linkPath,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      await assert.rejects(
        initializeGit(
          projectRoot,
          [
            "linked/outside.txt",
          ],
          async request =>
            processResult(
              request
            )
        ),
        isUnsafeProjectPath
      );
    } finally {
      await rm(
        linkPath,
        {
          force: true,
        }
      );

      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
