import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";

import {
  PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES,
  PackageEnvironmentBroker,
} from "../../dist/packages/execution/packageEnvironmentBroker.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

function manifest(
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
  return createManifestV1({
    id,
    publisher: {
      id: publisherId,
      name: "Aurora Tests",
      url: "https://example.com/aurora-tests",
    },
    capabilities,
    hostEnvironment,
  });
}

function provider(
  value
) {
  const calls = [];

  return {
    calls,
    instance: {
      async readEnvironmentValue(
        identity,
        variableName
      ) {
        calls.push({
          packageId: identity.id,
          publisherId: identity.publisher.id,
          variableName,
        });

        return typeof value === "function"
          ? value(identity, variableName)
          : value;
      },
    },
  };
}

test(
  "declared host environment read uses the explicit host provider",
  async () => {
    const source = provider("ke");
    const broker =
      new PackageEnvironmentBroker(
        source.instance
      );

    assert.equal(
      await broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      "ke"
    );

    assert.deepEqual(
      source.calls,
      [
        {
          packageId: "test-package",
          publisherId: "aurora-tests",
          variableName: "AURORA_REGION",
        },
      ]
    );
  }
);

test(
  "empty host environment strings are valid",
  async () => {
    const source = provider("");
    const broker = new PackageEnvironmentBroker(source.instance);

    assert.equal(
      await broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      ""
    );
  }
);

test(
  "optional missing host environment value returns null",
  async () => {
    const source = provider(null);
    const broker = new PackageEnvironmentBroker(source.instance);

    const candidate = manifest({
      hostEnvironment: [
        {
          name: "CI",
          required: false,
        },
      ],
    });

    assert.equal(
      await broker.readEnvironmentVariable(
        candidate,
        "CI"
      ),
      null
    );
  }
);

test(
  "required missing host environment value fails distinctly",
  async () => {
    const source = provider(null);
    const broker = new PackageEnvironmentBroker(source.instance);

    await assert.rejects(
      broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_ENVIRONMENT_REQUIRED"
        );
        return true;
      }
    );

    assert.equal(source.calls.length, 1);
  }
);

test(
  "undeclared host environment variable fails before provider access",
  async () => {
    const source = provider("true");
    const broker = new PackageEnvironmentBroker(source.instance);

    await assert.rejects(
      broker.readEnvironmentVariable(
        manifest(),
        "CI"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /explicitly declare/);
        return true;
      }
    );

    assert.equal(source.calls.length, 0);
  }
);

test(
  "host.environment.read capability is required before provider access",
  async () => {
    const source = provider("ke");
    const broker = new PackageEnvironmentBroker(source.instance);

    const candidate = manifest({
      capabilities: [],
    });

    await assert.rejects(
      broker.readEnvironmentVariable(
        candidate,
        "AURORA_REGION"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
        assert.match(error.message, /host\.environment\.read/);
        return true;
      }
    );

    assert.equal(source.calls.length, 0);
  }
);

test(
  "invalid variable names fail before provider access",
  async () => {
    const source = provider("value");
    const broker = new PackageEnvironmentBroker(source.instance);

    for (const name of [
      "",
      "lowercase",
      "HAS-DASH",
      "../PATH",
    ]) {
      await assert.rejects(
        broker.readEnvironmentVariable(
          manifest(),
          name
        ),
        error => {
          assert.equal(error.code, "PACKAGE_PERMISSION_DENIED");
          return true;
        }
      );
    }

    assert.equal(source.calls.length, 0);
  }
);

test(
  "exactly 64 KiB host environment value is accepted",
  async () => {
    const value =
      "a".repeat(
        PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
      );

    const source = provider(value);
    const broker = new PackageEnvironmentBroker(source.instance);

    assert.equal(
      await broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      value
    );
  }
);

test(
  "host environment value above 64 KiB fails closed",
  async () => {
    const value =
      "a".repeat(
        PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES + 1
      );

    const source = provider(value);
    const broker = new PackageEnvironmentBroker(source.instance);

    await assert.rejects(
      broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_EXECUTION_FAILED");
        assert.match(error.message, /exceeding/);
        return true;
      }
    );
  }
);

test(
  "host environment limit is measured in UTF-8 bytes",
  async () => {
    const value =
      "€".repeat(21846);

    assert.ok(
      Buffer.byteLength(value, "utf8") >
      PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
    );

    const source = provider(value);
    const broker = new PackageEnvironmentBroker(source.instance);

    await assert.rejects(
      broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_EXECUTION_FAILED");
        return true;
      }
    );
  }
);

test(
  "NUL-containing provider values fail closed",
  async () => {
    const source = provider("safe\0unsafe");
    const broker = new PackageEnvironmentBroker(source.instance);

    await assert.rejects(
      broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_EXECUTION_FAILED");
        assert.match(error.message, /NUL/);
        return true;
      }
    );
  }
);

test(
  "non-string provider values fail closed at runtime",
  async () => {
    const source = provider(42);
    const broker = new PackageEnvironmentBroker(source.instance);

    await assert.rejects(
      broker.readEnvironmentVariable(
        manifest(),
        "AURORA_REGION"
      ),
      error => {
        assert.equal(error.code, "PACKAGE_EXECUTION_FAILED");
        assert.match(error.message, /non-string/);
        return true;
      }
    );
  }
);

test(
  "package environment broker has no direct process.env source",
  async () => {
    const source = await readFile(
      new URL(
        "../../src/packages/execution/packageEnvironmentBroker.ts",
        import.meta.url
      ),
      "utf8"
    );

    assert.equal(
      source.includes("process.env"),
      false
    );
  }
);
