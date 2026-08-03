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

import {
  AURORA_CLI_METADATA,
  AURORA_CLI_VERSION,
} from "../../dist/core/packageMetadata.js";

import {
  getBannerText,
} from "../../dist/utils/banner.js";

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
  "runtime CLI metadata matches package.json",
  async () => {
    const packageJson =
      await readJson(
        "package.json"
      );

    assert.deepEqual(
      AURORA_CLI_METADATA,
      {
        name:
          packageJson.name,

        version:
          packageJson.version,

        description:
          packageJson.description,
      }
    );

    assert.equal(
      AURORA_CLI_VERSION,
      packageJson.version
    );
  }
);

test(
  "package lock release versions match package.json",
  async () => {
    const packageJson =
      await readJson(
        "package.json"
      );

    const packageLock =
      await readJson(
        "package-lock.json"
      );

    assert.equal(
      packageLock.version,
      packageJson.version
    );

    assert.equal(
      packageLock.packages[""].version,
      packageJson.version
    );
  }
);

test(
  "Aurora banner displays the package version",
  () => {
    const banner =
      getBannerText();

    assert.ok(
      banner.includes(
        `Aurora CLI v${AURORA_CLI_VERSION}`
      )
    );
  }
);