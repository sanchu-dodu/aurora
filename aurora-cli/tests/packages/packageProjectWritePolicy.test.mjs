import test from "node:test";
import assert from "node:assert/strict";

import {
  assertPackageProjectFileWrite,
} from "../../dist/packages/execution/packageProjectWritePolicy.js";

test(
  "generic package file writes allow ordinary project source paths",
  () => {
    for (const candidate of [
      "src/auth.ts",
      "app/api/auth/route.ts",
      "components/AuthButton.tsx",
      "public/aurora.svg",
      "middleware.ts",
    ]) {
      assert.doesNotThrow(
        () =>
          assertPackageProjectFileWrite(
            "example",
            candidate
          ),
        candidate
      );
    }
  }
);

test(
  "generic package file writes cannot target protected project control surfaces",
  () => {
    for (const candidate of [
      "package.json",
      "PACKAGE.JSON",
      "package-lock.json",
      ".env",
      ".env.local",
      "config/.ENV.PRODUCTION",
      ".aurora/cache.json",
      "aurora.lock",
      ".git/hooks/pre-commit",
      ".github/workflows/publish.yml",
      ".husky/pre-commit",
      ".devcontainer/devcontainer.json",
      ".circleci/config.yml",
      ".npmrc",
      ".pnpmfile.cjs",
      "src/../package.json",
    ]) {
      assert.throws(
        () =>
          assertPackageProjectFileWrite(
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
            /protected project control surface/,
            candidate
          );

          return true;
        }
      );
    }
  }
);
