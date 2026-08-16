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
        "host.environment.read",
        "host.secrets.read",
        "package.code.execute",
        "project.files.read",
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

function environmentManifest(
  {
    id = "test-package",
    publisherId = "aurora-tests",
    capabilities = ["host.environment.read"],
    hostEnvironment = [
      {
        name: "AURORA_REGION",
        required: true,
      },
    ],
  } = {}
) {
  return {
    ...manifest(
      capabilities,
      { id, publisherId }
    ),
    hostEnvironment,
  };
}

function environmentGrant(
  {
    publisherId = "aurora-tests",
    packageId = "test-package",
    variables = ["AURORA_REGION"],
  } = {}
) {
  return {
    publisherId,
    packageId,
    variables,
  };
}

test(
  "default package policy excludes host environment reads",
  () => {
    assert.equal(
      DEFAULT_PACKAGE_ALLOWED_CAPABILITIES.includes(
        "host.environment.read"
      ),
      false
    );
  }
);

test(
  "default package policy denies host environment access",
  () => {
    const policy = new PackageCapabilityPolicy();

    assert.throws(
      () => policy.assertManifest(environmentManifest()),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /package-scoped environment grant/);
        return true;
      }
    );
  }
);

test(
  "generic allowedCapabilities cannot grant host environment reads",
  () => {
    const policy = new PackageCapabilityPolicy({
      allowedCapabilities: ["host.environment.read"],
    });

    assert.throws(
      () => policy.assertManifest(environmentManifest()),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /package-scoped environment grant/);
        return true;
      }
    );
  }
);

test(
  "matching exact environment grant admits capability and variable",
  () => {
    const policy = new PackageCapabilityPolicy({
      packageEnvironmentGrants: [environmentGrant()],
    });

    const candidate = environmentManifest();

    assert.doesNotThrow(() => policy.assertManifest(candidate));
    assert.doesNotThrow(() => policy.assertCapability(
      candidate,
      "host.environment.read"
    ));
    assert.doesNotThrow(() => policy.assertEnvironmentAccess(
      candidate,
      "AURORA_REGION"
    ));
  }
);

test(
  "wrong package environment grant fails closed",
  () => {
    const policy = new PackageCapabilityPolicy({
      packageEnvironmentGrants: [
        environmentGrant({ packageId: "dependency-package" }),
      ],
    });

    assert.throws(
      () => policy.assertManifest(environmentManifest()),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        return true;
      }
    );
  }
);

test(
  "wrong publisher environment grant fails closed",
  () => {
    const policy = new PackageCapabilityPolicy({
      packageEnvironmentGrants: [
        environmentGrant({ publisherId: "other-publisher" }),
      ],
    });

    assert.throws(
      () => policy.assertManifest(environmentManifest()),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        return true;
      }
    );
  }
);

test(
  "partial environment grant authorizes only exact variables",
  () => {
    const policy = new PackageCapabilityPolicy({
      packageEnvironmentGrants: [environmentGrant()],
    });

    const candidate = environmentManifest({
      hostEnvironment: [
        { name: "AURORA_REGION", required: true },
        { name: "CI", required: false },
      ],
    });

    assert.doesNotThrow(() => policy.assertManifest(candidate));
    assert.doesNotThrow(() => policy.assertEnvironmentAccess(
      candidate,
      "AURORA_REGION"
    ));

    assert.throws(
      () => policy.assertEnvironmentAccess(candidate, "CI"),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /package-scoped environment policy/);
        return true;
      }
    );
  }
);

test(
  "environment grant cannot authorize an undeclared variable",
  () => {
    const policy = new PackageCapabilityPolicy({
      packageEnvironmentGrants: [
        environmentGrant({
          variables: ["AURORA_REGION", "CI"],
        }),
      ],
    });

    const candidate = environmentManifest();

    assert.throws(
      () => policy.assertEnvironmentAccess(candidate, "CI"),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /not declared/);
        return true;
      }
    );
  }
);

test(
  "environment grant cannot authorize an undeclared capability",
  () => {
    const policy = new PackageCapabilityPolicy({
      packageEnvironmentGrants: [environmentGrant()],
    });

    const candidate = environmentManifest({
      capabilities: [],
    });

    assert.throws(
      () => policy.assertEnvironmentAccess(
        candidate,
        "AURORA_REGION"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /not declared/);
        return true;
      }
    );
  }
);

test(
  "environment grants do not grant ordinary capabilities",
  () => {
    const policy = new PackageCapabilityPolicy({
      allowedCapabilities: ["package.code.execute"],
      packageEnvironmentGrants: [environmentGrant()],
    });

    const candidate = environmentManifest({
      capabilities: [
        "host.environment.read",
        "project.files.write",
      ],
    });

    assert.throws(
      () => policy.assertManifest(candidate),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /project\.files\.write/);
        return true;
      }
    );
  }
);

function projectFileReadManifest(
  {
    id = "test-package",
    publisherId = "aurora-tests",
    capabilities = [
      "project.files.read",
    ],
    projectFileReads = [
      {
        path: "package.json",
        required: true,
      },
    ],
  } = {}
) {
  return {
    ...manifest(
      capabilities,
      { id, publisherId }
    ),
    projectFileReads,
  };
}

function projectFileGrant(
  {
    publisherId = "aurora-tests",
    packageId = "test-package",
    paths = ["package.json"],
  } = {}
) {
  return {
    publisherId,
    packageId,
    paths,
  };
}

test(
  "default package policy excludes project file reads",
  () => {
    assert.equal(
      DEFAULT_PACKAGE_ALLOWED_CAPABILITIES
        .includes(
          "project.files.read"
        ),
      false
    );
  }
);

test(
  "default package policy denies project file reads",
  () => {
    const policy =
      new PackageCapabilityPolicy();

    assert.throws(
      () =>
        policy.assertManifest(
          projectFileReadManifest()
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        assert.match(
          error.message,
          /package-scoped project-file grant/
        );
        return true;
      }
    );
  }
);

test(
  "generic allowedCapabilities cannot grant project file reads",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        allowedCapabilities: [
          "project.files.read",
        ],
      });

    assert.throws(
      () =>
        policy.assertManifest(
          projectFileReadManifest()
        ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        assert.match(
          error.message,
          /package-scoped project-file grant/
        );
        return true;
      }
    );
  }
);

test(
  "matching exact project file grant admits capability and path",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageProjectFileGrants: [
          projectFileGrant(),
        ],
      });

    const candidate =
      projectFileReadManifest();

    assert.doesNotThrow(
      () => policy.assertManifest(candidate)
    );

    assert.doesNotThrow(
      () => policy.assertCapability(
        candidate,
        "project.files.read"
      )
    );

    assert.doesNotThrow(
      () => policy.assertProjectFileReadAccess(
        candidate,
        "package.json"
      )
    );
  }
);

test(
  "wrong package project file grant does not propagate to a dependency",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageProjectFileGrants: [
          projectFileGrant({
            packageId: "root-package",
          }),
        ],
      });

    assert.throws(
      () =>
        policy.assertManifest(
          projectFileReadManifest({
            id: "dependency-package",
          })
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
);

test(
  "wrong publisher project file grant fails closed",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageProjectFileGrants: [
          projectFileGrant({
            publisherId: "other-publisher",
          }),
        ],
      });

    assert.throws(
      () =>
        policy.assertManifest(
          projectFileReadManifest()
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
);

test(
  "project file grant cannot authorize an undeclared path",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageProjectFileGrants: [
          projectFileGrant({
            paths: [
              "package.json",
              "config/hidden.json",
            ],
          }),
        ],
      });

    const candidate =
      projectFileReadManifest();

    assert.doesNotThrow(
      () => policy.assertManifest(candidate)
    );

    assert.throws(
      () => policy.assertProjectFileReadAccess(
        candidate,
        "config/hidden.json"
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
  "partial project file grant authorizes only exact declared paths",
  () => {
    const policy =
      new PackageCapabilityPolicy({
        packageProjectFileGrants: [
          projectFileGrant({
            paths: ["package.json"],
          }),
        ],
      });

    const candidate =
      projectFileReadManifest({
        projectFileReads: [
          {
            path: "package.json",
            required: true,
          },
          {
            path: "config/app.json",
            required: false,
          },
        ],
      });

    assert.doesNotThrow(
      () => policy.assertManifest(candidate)
    );

    assert.doesNotThrow(
      () => policy.assertProjectFileReadAccess(
        candidate,
        "package.json"
      )
    );

    assert.throws(
      () => policy.assertProjectFileReadAccess(
        candidate,
        "config/app.json"
      ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        assert.match(
          error.message,
          /project-file policy/
        );
        return true;
      }
    );
  }
);

test(
  "network and process capabilities remain unsupported with project file reads",
  () => {
    for (const capability of [
      "network.access",
      "process.execute",
    ]) {
      const policy =
        new PackageCapabilityPolicy({
          allowedCapabilities: [
            capability,
          ],
          packageProjectFileGrants: [
            projectFileGrant(),
          ],
        });

      assert.throws(
        () =>
          policy.assertManifest(
            manifest([capability])
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );
          assert.match(
            error.message,
            /not supported/
          );
          return true;
        }
      );
    }
  }
);
