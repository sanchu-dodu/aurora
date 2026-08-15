import test from "node:test";
import assert from "node:assert/strict";

import {
  PackageSecretBroker,
  derivePackageSecretCredentialId,
} from "../../dist/packages/execution/packageSecretBroker.js";

function identity(
  publisherId = "aurora-technologies",
  packageId = "example-package"
) {
  return {
    id: packageId,
    publisher: {
      id: publisherId,
    },
  };
}

function manifest({
  publisherId =
    "aurora-technologies",
  packageId =
    "example-package",
  capabilities = [
    "host.secrets.read",
  ],
  secrets = [
    {
      name:
        "database-password",
      required: true,
    },
  ],
} = {}) {
  return {
    ...identity(
      publisherId,
      packageId
    ),
    capabilities,
    secrets,
  };
}

function createStore(
  value = "secret-value"
) {
  const calls = [];

  return {
    calls,

    store: {
      async set() {
        throw new Error(
          "PackageSecretBroker must not write credentials."
        );
      },

      async get(
        credentialId,
        context
      ) {
        calls.push({
          credentialId,
          context,
        });

        return value;
      },

      async delete() {
        throw new Error(
          "PackageSecretBroker must not delete credentials."
        );
      },
    },
  };
}

test(
  "package secret credential ids are deterministic and canonical",
  () => {
    const first =
      derivePackageSecretCredentialId(
        identity(),
        "database-password"
      );

    const second =
      derivePackageSecretCredentialId(
        identity(),
        "database-password"
      );

    assert.equal(first, second);

    assert.match(
      first,
      /^package-secret\.[a-f0-9]{64}$/
    );
  }
);

test(
  "component boundaries cannot alias package secret credential ids",
  () => {
    const left =
      derivePackageSecretCredentialId(
        identity(
          "publisher.alpha",
          "package"
        ),
        "secret"
      );

    const right =
      derivePackageSecretCredentialId(
        identity(
          "publisher",
          "alpha.package"
        ),
        "secret"
      );

    assert.notEqual(left, right);
  }
);

test(
  "declared package secret performs one host-owned audited credential read",
  async () => {
    const fake =
      createStore("top-secret");

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    const value =
      await broker.readSecret(
        manifest(),
        "database-password"
      );

    assert.equal(
      value,
      "top-secret"
    );

    assert.equal(
      fake.calls.length,
      1
    );

    assert.deepEqual(
      fake.calls[0],
      {
        credentialId:
          derivePackageSecretCredentialId(
            identity(),
            "database-password"
          ),
        context: {
          scope: "local",
          purpose:
            "package-secret-read",
        },
      }
    );
  }
);

test(
  "optional missing package secret remains null",
  async () => {
    const fake =
      createStore(null);

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    const value =
      await broker.readSecret(
        manifest({
          secrets: [
            {
              name: "optional-token",
              required: false,
            },
          ],
        }),
        "optional-token"
      );

    assert.equal(value, null);
    assert.equal(fake.calls.length, 1);
  }
);

test(
  "undeclared secret names fail before credential-store access",
  async () => {
    const fake = createStore();

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    await assert.rejects(
      broker.readSecret(
        manifest(),
        "undeclared-secret"
      ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        assert.match(
          error.message,
          /explicitly declare/
        );

        return true;
      }
    );

    assert.equal(fake.calls.length, 0);
  }
);

test(
  "host.secrets.read declaration is required before broker access",
  async () => {
    const fake = createStore();

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    await assert.rejects(
      broker.readSecret(
        manifest({
          capabilities: [],
        }),
        "database-password"
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

        return true;
      }
    );

    assert.equal(fake.calls.length, 0);
  }
);

test(
  "package secret named aurora-cloud remains isolated from Aurora internal credential id",
  async () => {
    const fake =
      createStore("isolated-value");

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    await broker.readSecret(
      manifest({
        secrets: [
          {
            name: "aurora-cloud",
            required: true,
          },
        ],
      }),
      "aurora-cloud"
    );

    assert.equal(fake.calls.length, 1);

    assert.notEqual(
      fake.calls[0].credentialId,
      "aurora-cloud"
    );

    assert.match(
      fake.calls[0].credentialId,
      /^package-secret\.[a-f0-9]{64}$/
    );
  }
);

test(
  "different packages receive different secret namespaces",
  () => {
    assert.notEqual(
      derivePackageSecretCredentialId(
        identity(
          "aurora-technologies",
          "auth"
        ),
        "shared-secret"
      ),
      derivePackageSecretCredentialId(
        identity(
          "aurora-technologies",
          "database"
        ),
        "shared-secret"
      )
    );
  }
);

test(
  "different publishers receive different secret namespaces",
  () => {
    assert.notEqual(
      derivePackageSecretCredentialId(
        identity(
          "aurora-technologies",
          "auth"
        ),
        "shared-secret"
      ),
      derivePackageSecretCredentialId(
        identity(
          "community-publisher",
          "auth"
        ),
        "shared-secret"
      )
    );
  }
);

test(
  "invalid package secret names fail before credential-store access",
  async () => {
    for (const secretName of [
      "",
      "UPPERCASE",
      "../escape",
      "with/slash",
      ".leading",
      "trailing.",
      "contains space",
    ]) {
      const fake = createStore();

      const broker =
        new PackageSecretBroker(
          fake.store
        );

      await assert.rejects(
        broker.readSecret(
          manifest({
            secrets: [
              {
                name: secretName,
                required: true,
              },
            ],
          }),
          secretName
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          return true;
        }
      );

      assert.equal(fake.calls.length, 0);
    }
  }
);

test(
  "invalid publisher and package identities fail before credential-store access",
  async () => {
    const fake = createStore();

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    await assert.rejects(
      broker.readSecret(
        manifest({
          publisherId:
            "Aurora-Technologies",
        }),
        "database-password"
      ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        return true;
      }
    );

    await assert.rejects(
      broker.readSecret(
        manifest({
          packageId: "../auth",
        }),
        "database-password"
      ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );

        return true;
      }
    );

    assert.equal(fake.calls.length, 0);
  }
);

test(
  "package secret broker remains read-only",
  () => {
    const fake = createStore();

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    assert.equal(
      typeof broker.readSecret,
      "function"
    );

    assert.equal(
      broker.setSecret,
      undefined
    );

    assert.equal(
      broker.deleteSecret,
      undefined
    );
  }
);

test(
  "required missing package secret fails distinctly after the audited read",
  async () => {
    const fake =
      createStore(null);

    const broker =
      new PackageSecretBroker(
        fake.store
      );

    await assert.rejects(
      broker.readSecret(
        manifest({
          secrets: [
            {
              name: "required-token",
              required: true,
            },
          ],
        }),
        "required-token"
      ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_SECRET_REQUIRED"
        );

        assert.match(
          error.message,
          /required-token/
        );

        return true;
      }
    );

    assert.equal(
      fake.calls.length,
      1
    );
  }
);
