import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePackage,
} from "../../dist/packages/packageValidator.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

function assertInvalid(
  manifest,
  message
) {
  assert.throws(
    () => validatePackage(manifest),
    error => {
      assert.equal(
        error.code,
        "INVALID_PACKAGE_MANIFEST"
      );

      assert.match(
        error.message,
        message
      );

      return true;
    }
  );
}

test(
  "existing manifests remain shape-compatible without hostEnvironment",
  () => {
    const manifest = createManifestV1();
    const validated = validatePackage(manifest);

    assert.equal(
      Object.hasOwn(manifest, "hostEnvironment"),
      false
    );

    assert.equal(
      Object.hasOwn(validated, "hostEnvironment"),
      false
    );
  }
);

test(
  "Manifest v1 accepts explicit host environment declarations",
  () => {
    const validated =
      validatePackage(
        createManifestV1({
          capabilities: [
            "host.environment.read",
          ],
          hostEnvironment: [
            {
              name: "AURORA_REGION",
              required: true,
            },
            {
              name: "CI",
              required: false,
            },
          ],
        })
      );

    assert.equal(
      validated.hostEnvironment.length,
      2
    );

    assert.equal(
      validated.hostEnvironment[0].name,
      "AURORA_REGION"
    );
  }
);

test(
  "host environment declarations require host.environment.read",
  () => {
    assertInvalid(
      createManifestV1({
        hostEnvironment: [
          {
            name: "AURORA_REGION",
            required: true,
          },
        ],
      }),
      /host\.environment\.read/
    );
  }
);

test(
  "host.environment.read requires explicitly named variables",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.environment.read",
        ],
      }),
      /explicitly declared host environment variable/
    );

    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.environment.read",
        ],
        hostEnvironment: [],
      }),
      /explicitly declared host environment variable/
    );
  }
);

test(
  "duplicate host environment names fail closed",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.environment.read",
        ],
        hostEnvironment: [
          {
            name: "AURORA_REGION",
            required: true,
          },
          {
            name: "AURORA_REGION",
            required: false,
          },
        ],
      }),
      /hostEnvironment cannot contain duplicate values/
    );
  }
);

test(
  "unsafe host environment names fail validation",
  () => {
    for (const name of [
      "lowercase",
      "HAS-DASH",
      "../PATH",
      "A=B",
      "CONTAINS SPACE",
    ]) {
      assertInvalid(
        createManifestV1({
          capabilities: [
            "host.environment.read",
          ],
          hostEnvironment: [
            {
              name,
              required: true,
            },
          ],
        }),
        /uppercase letters, numbers, and underscores/
      );
    }
  }
);

test(
  "host environment declarations reject secret metadata",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.environment.read",
        ],
        hostEnvironment: [
          {
            name: "AURORA_REGION",
            required: true,
            secret: true,
          },
        ],
      }),
      /secret/
    );
  }
);

test(
  "host environment declarations are cryptographically bound",
  () => {
    const base = createManifestV1();

    const required = {
      ...base,
      capabilities: [
        "host.environment.read",
      ],
      hostEnvironment: [
        {
          name: "AURORA_REGION",
          required: true,
        },
      ],
    };

    const optional = {
      ...required,
      hostEnvironment: [
        {
          name: "AURORA_REGION",
          required: false,
        },
      ],
    };

    assert.notDeepEqual(
      createPackageSigningPayload(base),
      createPackageSigningPayload(required)
    );

    assert.notDeepEqual(
      createPackageSigningPayload(required),
      createPackageSigningPayload(optional)
    );
  }
);
