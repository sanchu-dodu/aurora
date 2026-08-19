import test from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

import {
  validatePackage,
} from "../../dist/packages/packageValidator.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

function declaration(
  origin = "https://api.example.com",
  methods = ["GET"]
) {
  return {
    origin,
    methods,
  };
}

function manifestWithNetwork(
  networkAccess,
  capabilities = ["network.access"]
) {
  return createManifestV1({
    capabilities,
    networkAccess,
  });
}

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
  "existing manifests preserve networkAccess field absence",
  () => {
    const manifest =
      createManifestV1();

    const validated =
      validatePackage(manifest);

    assert.equal(
      Object.hasOwn(
        manifest,
        "networkAccess"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        validated,
        "networkAccess"
      ),
      false
    );
  }
);

test(
  "Manifest v1 accepts canonical HTTPS origins and all supported methods",
  () => {
    const validated =
      validatePackage(
        manifestWithNetwork([
          declaration(
            "https://api.example.com",
            [
              "GET",
              "HEAD",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
            ]
          ),
          declaration(
            "https://api.example.com:8443",
            ["GET"]
          ),
        ])
      );

    assert.equal(
      validated.networkAccess.length,
      2
    );

    assert.deepEqual(
      validated.networkAccess[0].methods,
      [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
      ]
    );
  }
);

test(
  "network methods reject unsupported and lowercase spellings",
  () => {
    for (const method of [
      "get",
      "OPTIONS",
      "CONNECT",
      "TRACE",
    ]) {
      assertInvalid(
        manifestWithNetwork([
          declaration(
            "https://api.example.com",
            [method]
          ),
        ]),
        /method|GET|HEAD|POST|PUT|PATCH|DELETE/i
      );
    }
  }
);

test(
  "network method lists reject empty and duplicate values",
  () => {
    assertInvalid(
      manifestWithNetwork([
        declaration(
          "https://api.example.com",
          []
        ),
      ]),
      /method|too small|1/i
    );

    assertInvalid(
      manifestWithNetwork([
        declaration(
          "https://api.example.com",
          ["GET", "GET"]
        ),
      ]),
      /duplicate/i
    );
  }
);

test(
  "duplicate network origins fail closed",
  () => {
    assertInvalid(
      manifestWithNetwork([
        declaration(
          "https://api.example.com",
          ["GET"]
        ),
        declaration(
          "https://api.example.com",
          ["POST"]
        ),
      ]),
      /networkAccess cannot contain duplicate values/
    );
  }
);

test(
  "network access declarations are limited to twenty-five origins",
  () => {
    const declarations =
      Array.from(
        { length: 25 },
        (_, index) =>
          declaration(
            `https://api-${index}.example.com`,
            ["GET"]
          )
      );

    const validated =
      validatePackage(
        manifestWithNetwork(
          declarations
        )
      );

    assert.equal(
      validated.networkAccess.length,
      25
    );

    assertInvalid(
      manifestWithNetwork([
        ...declarations,
        declaration(
          "https://overflow.example.com",
          ["GET"]
        ),
      ]),
      /25|too big|at most/i
    );
  }
);

test(
  "network declarations require network.access capability",
  () => {
    assertInvalid(
      manifestWithNetwork(
        [declaration()],
        []
      ),
      /network\.access/
    );
  }
);

test(
  "network.access requires at least one declared origin",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "network.access",
        ],
      }),
      /explicitly declared network origin/
    );

    assertInvalid(
      manifestWithNetwork([]),
      /explicitly declared network origin/
    );
  }
);

test(
  "network origins require exact canonical public-host HTTPS origin form",
  () => {
    for (const origin of [
      "http://api.example.com",
      "https://api.example.com/",
      "https://API.EXAMPLE.COM",
      "https://api.example.com:443",
      "https://api.example.com/v1",
      "https://api.example.com?x=1",
      "https://api.example.com#section",
      "https://user:pass@api.example.com",
      "https://127.0.0.1",
      "https://[::1]",
      "https://localhost",
      "https://api.example.com.",
    ]) {
      assertInvalid(
        manifestWithNetwork([
          declaration(
            origin,
            ["GET"]
          ),
        ]),
        /canonical HTTPS origin/i
      );
    }
  }
);

test(
  "network access declarations reject unknown metadata",
  () => {
    assertInvalid(
      manifestWithNetwork([
        {
          ...declaration(),
          wildcard: true,
        },
      ]),
      /wildcard/
    );
  }
);

test(
  "networkAccess declarations are cryptographically bound",
  () => {
    const {
      publicKey,
      privateKey,
    } =
      generateKeyPairSync(
        "ed25519"
      );

    const original =
      manifestWithNetwork([
        declaration(
          "https://api.example.com",
          ["GET"]
        ),
      ]);

    const originalPayload =
      createPackageSigningPayload(
        original
      );

    const signature =
      sign(
        null,
        originalPayload,
        privateKey
      );

    assert.equal(
      verify(
        null,
        originalPayload,
        publicKey,
        signature
      ),
      true
    );

    const changedOrigin = {
      ...original,
      networkAccess: [
        declaration(
          "https://other.example.com",
          ["GET"]
        ),
      ],
    };

    const changedMethods = {
      ...original,
      networkAccess: [
        declaration(
          "https://api.example.com",
          ["POST"]
        ),
      ],
    };

    assert.equal(
      verify(
        null,
        createPackageSigningPayload(
          changedOrigin
        ),
        publicKey,
        signature
      ),
      false
    );

    assert.equal(
      verify(
        null,
        createPackageSigningPayload(
          changedMethods
        ),
        publicKey,
        signature
      ),
      false
    );
  }
);
