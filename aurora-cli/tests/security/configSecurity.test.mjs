import test from "node:test";
import assert from "node:assert/strict";

import {
  spawn,
} from "node:child_process";

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  loadConfig,
  saveConfig,
} from "../../dist/config/configManager.js";

import {
  defaultConfig,
} from "../../dist/config/defaults.js";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

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
  "configuration defaults are strict, validated, and stored without secrets",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-config-valid-"
      );

    try {
      assert.deepEqual(
        await loadConfig(
          projectRoot
        ),
        defaultConfig
      );

      await saveConfig(
        {
          ...defaultConfig,
          packageManager: "pnpm",
          initializeGit: false,
        },
        projectRoot
      );

      assert.deepEqual(
        await loadConfig(
          projectRoot
        ),
        {
          ...defaultConfig,
          packageManager: "pnpm",
          initializeGit: false,
        }
      );

      const raw = await readFile(
        join(
          projectRoot,
          ".aurora",
          "config.json"
        ),
        "utf8"
      );

      assert.equal(
        /token|password|secret/iu
          .test(raw),
        false
      );
    } finally {
      await removeProject(
        projectRoot
      );
    }
  }
);

test(
  "configuration rejects secret and unknown fields without echoing values",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-config-secret-"
      );
    const secret =
      "must-never-be-printed";

    try {
      await writeConfiguration(
        projectRoot,
        {
          ...defaultConfig,
          apiToken: secret,
        }
      );

      await assert.rejects(
        loadConfig(projectRoot),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .SECRET_IN_CONFIGURATION
          );
          assert.equal(
            error.message.includes(
              secret
            ),
            false
          );
          return true;
        }
      );

      const result = await runCli(
        [
          "config",
          "list",
        ],
        projectRoot
      );

      assert.equal(
        result.code,
        1
      );
      assert.match(
        result.stderr,
        /SECRET_IN_CONFIGURATION/u
      );
      assert.equal(
        `${result.stdout}${result.stderr}`
          .includes(secret),
        false
      );

      await writeConfiguration(
        projectRoot,
        {
          ...defaultConfig,
          harmlessUnknown: true,
        }
      );

      await assert.rejects(
        loadConfig(projectRoot),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .INVALID_CONFIGURATION
          );
          return true;
        }
      );
    } finally {
      await removeProject(
        projectRoot
      );
    }
  }
);

test(
  "configuration command rejects ambiguous booleans",
  async () => {
    const projectRoot =
      await temporaryProject(
        "aurora-config-boolean-"
      );

    try {
      const result = await runCli(
        [
          "config",
          "set",
          "initializeGit",
          "yes",
        ],
        projectRoot
      );

      assert.equal(
        result.code,
        1
      );
      assert.match(
        result.stderr,
        /INVALID_CONFIGURATION/u
      );
      assert.deepEqual(
        await loadConfig(
          projectRoot
        ),
        defaultConfig
      );
    } finally {
      await removeProject(
        projectRoot
      );
    }
  }
);

async function temporaryProject(
  prefix
) {
  return mkdtemp(
    join(
      tmpdir(),
      prefix
    )
  );
}

async function writeConfiguration(
  projectRoot,
  value
) {
  const configPath = join(
    projectRoot,
    ".aurora",
    "config.json"
  );

  await mkdir(
    dirname(configPath),
    {
      recursive: true,
    }
  );

  await writeFile(
    configPath,
    JSON.stringify(value),
    "utf8"
  );
}

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

async function removeProject(
  projectRoot
) {
  await rm(
    projectRoot,
    {
      recursive: true,
      force: true,
    }
  );
}
