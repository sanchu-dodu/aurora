import test from "node:test";
import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

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

async function readJson(
  relativePath
) {
  return JSON.parse(
    await readFile(
      join(
        cliRoot,
        relativePath
      ),
      "utf8"
    )
  );
}

test(
  "npm executable uses canonical package-relative metadata",
  async () => {
    const packageJson =
      await readJson(
        "package.json"
      );

    assert.deepEqual(
      packageJson.bin,
      {
        aurora:
          "dist/index.js",
      }
    );

    assert.doesNotMatch(
      packageJson.bin.aurora,
      /^\.?\//
    );

    const executable =
      await readFile(
        join(
          cliRoot,
          packageJson.bin.aurora
        ),
        "utf8"
      );

    assert.match(
      executable,
      /^#!\/usr\/bin\/env node(?:\r?\n)/
    );
  }
);

test(
  "package lock preserves the Aurora executable mapping",
  async () => {
    const packageLock =
      await readJson(
        "package-lock.json"
      );

    assert.deepEqual(
      packageLock
        .packages[""]
        .bin,
      {
        aurora:
          "dist/index.js",
      }
    );
  }
);