import test from "node:test";
import assert from "node:assert/strict";

import {
  BROKERED_PACKAGE_CAPABILITIES,
  DEFAULT_PACKAGE_ALLOWED_CAPABILITIES,
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

function manifest(
  capabilities = [],
  {
    id = "test-package",
    publisherId = "aurora-tests",
    secrets,
  } = {}
) {
  return {
    id,
    publisher: {
      id: publisherId,
    },
    capabilities,
    secrets:
      secrets ??
      (
        capabilities.includes(
          "host.secrets.read"
        )
          ? [
              {
                name:
                  "database-password",
                required: true,
              },
            ]
          : []
      ),
  };
}

function secretGrant(
  {
    publisherId = "aurora-tests",
    packageId = "test-package",
    secrets = [
      "database-password",
    ],
  } = {}
) {
  return {
    publisherId,
    packageId,
    secrets,
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
          /package-scoped secret grant/
        );

        return true;
      }
    );
  }
);

test(
  "generic allowedCapabilities cannot globally grant host secret reads",
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
          ])
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /package-scoped secret grant/
        );

        return true;
      }
    );
  }
);

test(
  "matching publisher package and declared secret grant admits host secret capability",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageSecretGrants: [
          secretGrant(),
        ],
      });

    const candidate =
      manifest([
        "host.secrets.read",
      ]);

    assert.doesNotThrow(
      () =>
        policy.assertManifest(
          candidate
        )
    );

    assert.doesNotThrow(
      () =>
        policy.assertCapability(
          candidate,
          "host.secrets.read"
        )
    );

    assert.doesNotThrow(
      () =>
        policy.assertSecretAccess(
          candidate,
          "database-password"
        )
    );
  }
);

test(
  "secret grant for another package does not authorize the candidate package",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageSecretGrants: [
          secretGrant({
            packageId:
              "dependency-package",
          }),
        ],
      });

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
          /package-scoped secret grant/
        );

        return true;
      }
    );
  }
);

test(
  "secret grant for another publisher does not authorize the candidate package",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageSecretGrants: [
          secretGrant({
            publisherId:
              "other-publisher",
          }),
        ],
      });

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
          /package-scoped secret grant/
        );

        return true;
      }
    );
  }
);

test(
  "exact secret grant does not authorize another declared secret",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageSecretGrants: [
          secretGrant(),
        ],
      });

    const candidate =
      manifest(
        [
          "host.secrets.read",
        ],
        {
          secrets: [
            {
              name:
                "database-password",
              required: true,
            },
            {
              name:
                "analytics-token",
              required: false,
            },
          ],
        }
      );

    assert.doesNotThrow(
      () =>
        policy.assertSecretAccess(
          candidate,
          "database-password"
        )
    );

    assert.throws(
      () =>
        policy.assertSecretAccess(
          candidate,
          "analytics-token"
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /analytics-token/
        );

        assert.match(
          error.message,
          /package-scoped secret policy/
        );

        return true;
      }
    );
  }
);

test(
  "scoped secret admission does not implicitly grant other capabilities",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "package.code.execute",
        ],
        packageSecretGrants: [
          secretGrant(),
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
  "host secret use fails if capability was not declared even when scoped grant exists",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageSecretGrants: [
          secretGrant(),
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
  "exact secret use fails if the secret is not declared by the manifest",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageSecretGrants: [
          secretGrant({
            secrets: [
              "database-password",
              "undeclared-secret",
            ],
          }),
        ],
      });

    const candidate =
      manifest([
        "host.secrets.read",
      ]);

    assert.throws(
      () =>
        policy.assertSecretAccess(
          candidate,
          "undeclared-secret"
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
