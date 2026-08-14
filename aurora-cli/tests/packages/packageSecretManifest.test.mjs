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
  "existing manifests remain shape-compatible without secrets",
  () => {
    const manifest = createManifestV1();
    const validated = validatePackage(manifest);

    assert.equal(
      Object.hasOwn(manifest, "secrets"),
      false
    );

    assert.equal(
      Object.hasOwn(validated, "secrets"),
      false
    );
  }
);

test(
  "Manifest v1 accepts explicit package secret declarations",
  () => {
    const validated =
      validatePackage(
        createManifestV1({
          capabilities: [
            "host.secrets.read",
          ],
          secrets: [
            {
              name: "database-password",
              required: true,
            },
            {
              name: "optional-token",
              required: false,
            },
          ],
        })
      );

    assert.equal(
      validated.secrets.length,
      2
    );

    assert.equal(
      validated.secrets[0].name,
      "database-password"
    );
  }
);

test(
  "secret declarations require host.secrets.read",
  () => {
    assertInvalid(
      createManifestV1({
        secrets: [
          {
            name: "database-password",
            required: true,
          },
        ],
      }),
      /host\.secrets\.read/
    );
  }
);

test(
  "host.secrets.read requires explicitly named secrets",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.secrets.read",
        ],
      }),
      /explicitly declared package secret/
    );

    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.secrets.read",
        ],
        secrets: [],
      }),
      /explicitly declared package secret/
    );
  }
);

test(
  "duplicate package secret names fail closed",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.secrets.read",
        ],
        secrets: [
          {
            name: "token",
            required: true,
          },
          {
            name: "token",
            required: false,
          },
        ],
      }),
      /secrets cannot contain duplicate values/
    );
  }
);

test(
  "unsafe package secret names fail validation",
  () => {
    for (const name of [
      "UPPERCASE",
      "../secret",
      "secret/name",
      "contains space",
    ]) {
      assertInvalid(
        createManifestV1({
          capabilities: [
            "host.secrets.read",
          ],
          secrets: [
            {
              name,
              required: true,
            },
          ],
        }),
        /Identifiers must use lowercase letters/
      );
    }
  }
);

test(
  "secret declarations reject raw credential identifiers",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "host.secrets.read",
        ],
        secrets: [
          {
            name: "database-password",
            required: true,
            credentialId: "aurora-cloud",
          },
        ],
      }),
      /credentialId/
    );
  }
);

test(
  "secret declarations are cryptographically bound",
  () => {
    const base = createManifestV1();

    const required = {
      ...base,
      capabilities: [
        "host.secrets.read",
      ],
      secrets: [
        {
          name: "database-password",
          required: true,
        },
      ],
    };

    const optional = {
      ...required,
      secrets: [
        {
          name: "database-password",
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
