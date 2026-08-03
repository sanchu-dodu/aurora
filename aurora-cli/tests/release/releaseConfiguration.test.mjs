import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
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

test(
  "package exposes the automated release check",
  async () => {
    const packageJson =
      JSON.parse(
        await readFile(
          join(
            cliRoot,
            "package.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      packageJson
        .scripts[
          "release:check"
        ],
      "npm test && node scripts/release-check.mjs"
    );

    await access(
      join(
        cliRoot,
        "scripts",
        "release-check.mjs"
      )
    );
  }
);

test(
  "Aurora CLI CI runs installed-package release validation",
  async () => {
    const workflow =
      await readFile(
        join(
          cliRoot,
          "..",
          ".github",
          "workflows",
          "aurora-cli-ci.yml"
        ),
        "utf8"
      );

    assert.match(
      workflow,
      /run:\s+npm run release:check/
    );

    assert.doesNotMatch(
      workflow,
      /run:\s+npm test\s*$/m
    );
  }
);