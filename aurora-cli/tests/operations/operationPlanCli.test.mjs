import test from "node:test";
import assert from "node:assert/strict";

import {
  spawn,
} from "node:child_process";

import {
  access,
  mkdtemp,
  readFile,
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

const cliRoot =
  fileURLToPath(
    new URL(
      "../../",
      import.meta.url
    )
  );

const cliEntry = join(
  cliRoot,
  "dist",
  "index.js"
);

test(
  "CLI exports, previews, and applies a configuration plan only after approval",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-plan-cli-"
        )
      );
    const planFile = join(
      projectRoot,
      "config-plan.json"
    );
    const configFile = join(
      projectRoot,
      ".aurora",
      "config.json"
    );

    try {
      const planned = await runCli(
        [
          "plan",
          "config",
          "set",
          "packageManager",
          "pnpm",
          "--out",
          planFile,
          "--json",
        ],
        projectRoot
      );

      assert.equal(
        planned.code,
        0
      );
      assertNoActivation(planned);
      assert.equal(
        await exists(configFile),
        false
      );

      const plan = JSON.parse(
        await readFile(
          planFile,
          "utf8"
        )
      );

      assert.equal(
        plan.intent,
        "config.set"
      );
      assert.equal(
        plan.operations[0].kind,
        "file.write"
      );

      const unapproved =
        await runCli(
          [
            "apply",
            planFile,
          ],
          projectRoot
        );

      assert.equal(
        unapproved.code,
        1
      );
      assert.match(
        unapproved.stderr,
        /OPERATION_APPROVAL_REQUIRED/u
      );
      assertNoActivation(
        unapproved
      );
      assert.equal(
        await exists(configFile),
        false
      );

      const dryRun = await runCli(
        [
          "apply",
          planFile,
          "--dry-run",
          "--json",
        ],
        projectRoot
      );

      assert.equal(dryRun.code, 0);
      assert.equal(
        JSON.parse(dryRun.stdout)
          .schemaVersion,
        1
      );
      assert.equal(
        JSON.parse(dryRun.stdout)
          .status,
        "dry-run"
      );
      assert.match(
        JSON.parse(dryRun.stdout)
          .reportId,
        /^report-/u
      );
      assertNoActivation(dryRun);
      assert.equal(
        await exists(configFile),
        false
      );

      const applied = await runCli(
        [
          "apply",
          planFile,
          "--yes",
          "--json",
        ],
        projectRoot
      );

      assert.equal(applied.code, 0);
      assert.equal(
        JSON.parse(applied.stdout)
          .status,
        "applied"
      );
      assert.equal(
        JSON.parse(applied.stdout)
          .totals.applied,
        1
      );
      assertNoActivation(applied);

      const config = JSON.parse(
        await readFile(
          configFile,
          "utf8"
        )
      );

      assert.equal(
        config.packageManager,
        "pnpm"
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
  "config set supports dry-run and requires approval for direct mutation",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-config-plan-cli-"
        )
      );
    const configFile = join(
      projectRoot,
      ".aurora",
      "config.json"
    );

    try {
      const unapproved =
        await runCli(
          [
            "config",
            "set",
            "initializeGit",
            "false",
          ],
          projectRoot
        );

      assert.equal(
        unapproved.code,
        1
      );
      assert.match(
        unapproved.stdout,
        /Aurora Operation Plan/u
      );
      assert.match(
        unapproved.stderr,
        /OPERATION_APPROVAL_REQUIRED/u
      );
      assertNoActivation(
        unapproved
      );
      assert.equal(
        await exists(configFile),
        false
      );

      const dryRun = await runCli(
        [
          "config",
          "set",
          "initializeGit",
          "false",
          "--dry-run",
          "--json",
        ],
        projectRoot
      );

      assert.equal(dryRun.code, 0);
      assert.equal(
        JSON.parse(dryRun.stdout)
          .status,
        "dry-run"
      );
      assert.equal(
        await exists(configFile),
        false
      );

      const applied = await runCli(
        [
          "config",
          "set",
          "initializeGit",
          "false",
          "--yes",
          "--json",
        ],
        projectRoot
      );

      assert.equal(applied.code, 0);
      assert.equal(
        JSON.parse(applied.stdout)
          .status,
        "applied"
      );
      assert.equal(
        JSON.parse(
          await readFile(
            configFile,
            "utf8"
          )
        ).initializeGit,
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
        code => {
          resolve({
            code,
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
    /Aurora Runtime/u
  );
  assert.doesNotMatch(
    output,
    /plugin activated/iu
  );
  assert.doesNotMatch(
    output,
    /The command center for Aurora/u
  );
}

async function exists(
  target
) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
