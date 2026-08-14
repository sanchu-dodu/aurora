import test from "node:test";
import assert from "node:assert/strict";

import {
  BROKERED_PACKAGE_CAPABILITIES,
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

function manifest(
  capabilities = []
) {
  return {
    id: "test-package",
    capabilities,
  };
}

test(
  "default package policy permits only brokered capabilities",
  () => {
    const policy =
      new PackageCapabilityPolicy();

    const candidate =
      manifest([
        "package.code.execute",
        "project.files.write",
        "project.dependencies.write",
        "project.environment.write",
      ]);

    assert.doesNotThrow(
      () =>
        policy.assertManifest(
          candidate
        )
    );

    assert.deepEqual(
      [...BROKERED_PACKAGE_CAPABILITIES],
      [
        "package.code.execute",
        "project.files.write",
        "project.dependencies.write",
        "project.environment.write",
      ]
    );
  }
);

test(
  "package policy rejects an unsupported declared capability",
  () => {
    const policy =
      new PackageCapabilityPolicy();

    assert.throws(
      () =>
        policy.assertManifest(
          manifest([
            "network.access",
          ])
        ),
      (error) => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /network\.access/
        );

        return true;
      }
    );
  }
);

test(
  "package policy rejects a supported capability denied by host policy",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "package.code.execute",
        ],
      });

    assert.throws(
      () =>
        policy.assertManifest(
          manifest([
            "package.code.execute",
            "project.files.write",
          ])
        ),
      (error) => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /project\.files\.write/
        );

        return true;
      }
    );
  }
);

test(
  "package policy rejects use of an undeclared capability",
  () => {
    const policy =
      new PackageCapabilityPolicy();

    assert.throws(
      () =>
        policy.assertCapability(
          manifest([
            "package.code.execute",
          ]),
          "project.environment.write"
        ),
      (error) => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /not declared/
        );

        return true;
      }
    );
  }
);

test(
  "package policy permits an explicitly declared and allowed capability",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "project.files.write",
        ],
      });

    assert.doesNotThrow(
      () =>
        policy.assertCapability(
          manifest([
            "project.files.write",
          ]),
          "project.files.write"
        )
    );
  }
);
