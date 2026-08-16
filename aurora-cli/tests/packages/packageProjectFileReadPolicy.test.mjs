import test from "node:test";
import assert from "node:assert/strict";

import {
  assertPackageProjectFileRead,
} from "../../dist/packages/execution/packageProjectFileReadPolicy.js";

test(
  "project file reads allow ordinary source, manifest, and lockfile paths",
  () => {
    for (const candidate of [
      "package.json",
      "PACKAGE.JSON",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      "aurora.lock",
      "tsconfig.json",
      "src/config.json",
      "config/app.json",
    ]) {
      assert.doesNotThrow(
        () =>
          assertPackageProjectFileRead(
            "example",
            candidate
          ),
        candidate
      );
    }
  }
);

test(
  "project file reads deny protected read-sensitive project surfaces case-insensitively",
  () => {
    for (const candidate of [
      ".git/config",
      ".GIT/config",
      "src/.git/config",
      ".aurora/state.json",
      "src/.AURORA/cache.json",
      ".env",
      ".ENV",
      ".env.local",
      ".ENV.PRODUCTION",
      "config/.env.local",
      "config/.ENV.PRODUCTION",
      ".npmrc",
      "config/.NPMRC",
      ".yarnrc",
      "config/.YARNRC",
      ".yarnrc.yml",
      "config/.YARNRC.YML",
      ".netrc",
      "config/.NETRC",
      "_netrc",
      "config/_NETRC",
      ".pypirc",
      "config/.PYPIRC",
    ]) {
      assert.throws(
        () =>
          assertPackageProjectFileRead(
            "example",
            candidate
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED",
            candidate
          );

          assert.match(
            error.message,
            /protected read-sensitive project surface/,
            candidate
          );

          return true;
        }
      );
    }
  }
);

test(
  "project file read policy handles alternate separators defensively for protected paths",
  () => {
    for (const candidate of [
      ".git\\config",
      "src\\.AURORA\\state.json",
      "config\\.ENV.LOCAL",
      "config\\.NPMRC",
    ]) {
      assert.throws(
        () =>
          assertPackageProjectFileRead(
            "example",
            candidate
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          return true;
        }
      );
    }
  }
);

test(
  "project file read policy does not overmatch safe lookalike names",
  () => {
    for (const candidate of [
      ".gitignore",
      ".gitattributes",
      ".aurora-config.json",
      ".envrc",
      ".environment",
      ".npmrc.example",
      ".yarnrc.example",
      ".netrc.example",
      "_netrc.example",
      ".pypirc.example",
      "config/npmrc",
    ]) {
      assert.doesNotThrow(
        () =>
          assertPackageProjectFileRead(
            "example",
            candidate
          ),
        candidate
      );
    }
  }
);
