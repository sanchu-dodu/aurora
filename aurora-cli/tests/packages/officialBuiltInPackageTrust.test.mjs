import assert from "node:assert/strict";

import {
  join,
} from "node:path";

import test from "node:test";

import {
  fileURLToPath,
} from "node:url";

import {
  loadManifest,
} from "../../dist/packages/manifestLoader.js";

import {
  AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID,
  AURORA_OFFICIAL_PUBLISHER_ID,
} from "../../dist/packages/trust/officialPublisherTrust.js";

import {
  PackageTrustPolicy,
} from "../../dist/packages/trust/packageTrustPolicy.js";

const CLI_ROOT =
  fileURLToPath(
    new URL(
      "../../",
      import.meta.url
    )
  );

const BUILT_INS =
  [
    "auth",
    "database",
    "env",
  ];

test(
  "default production trust authenticates every signed Aurora built-in package",
  async () => {
    const policy =
      new PackageTrustPolicy();

    for (
      const packageId
      of BUILT_INS
    ) {
      const manifest =
        await loadManifest(
          join(
            CLI_ROOT,
            "packages",
            packageId,
            "manifest.json"
          )
        );

      assert.equal(
        manifest.publisher.id,
        AURORA_OFFICIAL_PUBLISHER_ID
      );

      assert.equal(
        manifest.signature?.version,
        1
      );

      assert.equal(
        manifest.signature?.algorithm,
        "ed25519"
      );

      assert.equal(
        manifest.signature?.keyId,
        AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID
      );

      assert.match(
        manifest.signature?.value ?? "",
        /^[A-Za-z0-9_-]{86}$/
      );

      const verification =
        policy.verify(
          manifest
        );

      assert.ok(
        verification
      );

      assert.equal(
        verification.publisherId,
        AURORA_OFFICIAL_PUBLISHER_ID
      );

      assert.equal(
        verification.keyId,
        AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID
      );
    }
  }
);

test(
  "official signatures still fail closed when the caller explicitly supplies an empty trust store",
  async () => {
    const policy =
      new PackageTrustPolicy({
        trustedPublishers:
          [],
      });

    for (
      const packageId
      of BUILT_INS
    ) {
      const manifest =
        await loadManifest(
          join(
            CLI_ROOT,
            "packages",
            packageId,
            "manifest.json"
          )
        );

      assert.throws(
        () =>
          policy.verify(
            manifest
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PUBLISHER_UNTRUSTED"
          );

          return true;
        }
      );
    }
  }
);
