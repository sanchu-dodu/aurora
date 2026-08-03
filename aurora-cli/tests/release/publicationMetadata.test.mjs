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
  "npm publication metadata uses the authenticated user scope",
  async () => {
    const packageJson =
      await readJson(
        "package.json"
      );

    assert.equal(
      packageJson.name,
      "@kin666/aurora-cli"
    );

    assert.equal(
      packageJson.author,
      "kin666"
    );

    assert.equal(
      packageJson.license,
      "MIT"
    );

    assert.equal(
      packageJson.engines.node,
      ">=22"
    );

    assert.equal(
      packageJson
        .publishConfig
        .access,
      "public"
    );

    assert.notEqual(
      packageJson.private,
      true
    );
  }
);

test(
  "package lock identity matches publication metadata",
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
      packageLock.name,
      packageJson.name
    );

    assert.equal(
      packageLock
        .packages[""]
        .name,
      packageJson.name
    );

    assert.equal(
      packageLock.version,
      packageJson.version
    );

    assert.equal(
      packageLock
        .packages[""]
        .version,
      packageJson.version
    );
  }
);

test(
  "publication documents contain required project information",
  async () => {
    const readme =
      await readFile(
        join(
          cliRoot,
          "README.md"
        ),
        "utf8"
      );

    const license =
      await readFile(
        join(
          cliRoot,
          "LICENSE"
        ),
        "utf8"
      );

    const changelog =
      await readFile(
        join(
          cliRoot,
          "CHANGELOG.md"
        ),
        "utf8"
      );

    assert.match(
      readme,
      /@kin666\/aurora-cli/
    );

    assert.match(
      readme,
      /npm run release:check/
    );

    assert.match(
      license,
      /MIT License/
    );

    assert.match(
      license,
      /Copyright \(c\) 2026 kin666/
    );

    assert.match(
      changelog,
      /\[0\.1\.0\]/
    );
  }
);