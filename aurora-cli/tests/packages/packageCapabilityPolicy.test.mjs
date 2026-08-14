import test from "node:test";
import assert from "node:assert/strict";

import {
  BROKERED_PACKAGE_CAPABILITIES,
  DEFAULT_PACKAGE_ALLOWED_CAPABILITIES,
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
  "brokered capability inventory includes host secret reads",
  () => {
    assert.deepEqual(
      [...BROKERED_PACKAGE_CAPABILITIES],
      [
        "host.secrets.read",
        "package.code.execute",
        "project.files.write",
        "project.dependencies.write",
        "project.environment.write",
      ]
    );
  }
);

test(
  "default package policy excludes host secret reads",
  () => {
    assert.deepEqual(
      [...DEFAULT_PACKAGE_ALLOWED_CAPABILITIES],
      [
        "package.code.execute",
        "project.files.write",
        "project.dependencies.write",
        "project.environment.write",
      ]
    );

    assert.equal(
      DEFAULT_PACKAGE_ALLOWED_CAPABILITIES
        .includes(
          "host.secrets.read"
        ),
      false
    );
  }
);

test(
  "default package policy permits ordinary brokered capabilities",
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
  }
);

test(
  "default package policy denies a manifest declaring host secret access",
  () => {
    const policy =
      new PackageCapabilityPolicy();

    assert.throws(
      () =>
        policy.assertManifest(
          manifest([
            "host.secrets.read",
          ])
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /host\.secrets\.read/
        );

        assert.match(
          error.message,
          /denied by the active package execution policy/
        );

        return true;
      }
    );
  }
);

test(
  "host secret capability can only be admitted by explicit host policy",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "host.secrets.read",
        ],
      });

    assert.doesNotThrow(
      () =>
        policy.assertManifest(
          manifest([
            "host.secrets.read",
          ])
        )
    );

    assert.doesNotThrow(
      () =>
        policy.assertCapability(
          manifest([
            "host.secrets.read",
          ]),
          "host.secrets.read"
        )
    );
  }
);

test(
  "explicit secret admission does not implicitly grant other capabilities",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "host.secrets.read",
        ],
      });

    assert.throws(
      () =>
        policy.assertManifest(
          manifest([
            "host.secrets.read",
            "project.files.write",
          ])
        ),
      error => {
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
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /network\.access/
        );

        assert.match(
          error.message,
          /not supported/
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
      error => {
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
      error => {
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
  "host secret use fails if capability was not declared even when host allows it",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "host.secrets.read",
        ],
      });

    assert.throws(
      () =>
        policy.assertCapability(
          manifest([]),
          "host.secrets.read"
        ),
      error => {
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
  "package policy permits an explicitly declared and allowed ordinary capability",
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
