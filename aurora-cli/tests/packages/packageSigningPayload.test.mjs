import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeJson,
} from "../../dist/packages/trust/packageCanonicalJson.js";

import {
  createPackageSigningDocument,
  createPackageSigningPayload,
  PACKAGE_SIGNING_DOMAIN,
} from "../../dist/packages/trust/packageSigningPayload.js";

function createManifest(
  signatureValue = "first-signature"
) {
  return {
    manifestVersion: 1,
    kind: "package",
    id: "example",
    version: "1.0.0",
    publisher: {
      id: "aurora-tests",
    },
    signature: {
      version: 1,
      algorithm:
        "ed25519",
      keyId:
        "a".repeat(64),
      value:
        signatureValue,
    },
  };
}

test(
  "package signing payload is domain separated and canonical",
  () => {
    const manifest =
      createManifest();

    const payload =
      createPackageSigningPayload(
        manifest
      );

    const domainBytes =
      Buffer.from(
        `${PACKAGE_SIGNING_DOMAIN}\0`,
        "utf8"
      );

    assert.deepEqual(
      payload.subarray(
        0,
        domainBytes.length
      ),
      domainBytes
    );

    const signingDocument =
      createPackageSigningDocument(
        manifest
      );

    assert.equal(
      payload
        .subarray(
          domainBytes.length
        )
        .toString(
          "utf8"
        ),
      canonicalizeJson(
        signingDocument
      )
    );
  }
);

test(
  "signature value itself is excluded from the signing payload",
  () => {
    assert.deepEqual(
      createPackageSigningPayload(
        createManifest(
          "signature-one"
        )
      ),
      createPackageSigningPayload(
        createManifest(
          "signature-two"
        )
      )
    );
  }
);

test(
  "signature metadata remains cryptographically bound",
  () => {
    const original =
      createManifest();

    const changedKey = {
      ...createManifest(),
      signature: {
        ...createManifest()
          .signature,
        keyId:
          "b".repeat(64),
      },
    };

    const changedAlgorithm = {
      ...createManifest(),
      signature: {
        ...createManifest()
          .signature,
        algorithm:
          "different",
      },
    };

    assert.notDeepEqual(
      createPackageSigningPayload(
        original
      ),
      createPackageSigningPayload(
        changedKey
      )
    );

    assert.notDeepEqual(
      createPackageSigningPayload(
        original
      ),
      createPackageSigningPayload(
        changedAlgorithm
      )
    );
  }
);

test(
  "security-relevant manifest changes alter the signing payload",
  () => {
    const original =
      createManifest();

    const changedVersion = {
      ...createManifest(),
      version:
        "2.0.0",
    };

    const changedPublisher = {
      ...createManifest(),
      publisher: {
        id:
          "different-publisher",
      },
    };

    assert.notDeepEqual(
      createPackageSigningPayload(
        original
      ),
      createPackageSigningPayload(
        changedVersion
      )
    );

    assert.notDeepEqual(
      createPackageSigningPayload(
        original
      ),
      createPackageSigningPayload(
        changedPublisher
      )
    );
  }
);

test(
  "signing payload creation does not mutate the source manifest",
  () => {
    const manifest =
      createManifest(
        "retain-me"
      );

    createPackageSigningPayload(
      manifest
    );

    assert.equal(
      manifest.signature.value,
      "retain-me"
    );

    assert.equal(
      Object.hasOwn(
        manifest.signature,
        "value"
      ),
      true
    );
  }
);

test(
  "object insertion order does not change the signing payload",
  () => {
    const first =
      createManifest();

    const second = {
      signature: {
        value:
          "unimportant",
        keyId:
          "a".repeat(64),
        algorithm:
          "ed25519",
        version: 1,
      },
      publisher: {
        id:
          "aurora-tests",
      },
      version:
        "1.0.0",
      id:
        "example",
      kind:
        "package",
      manifestVersion: 1,
    };

    assert.deepEqual(
      createPackageSigningPayload(
        first
      ),
      createPackageSigningPayload(
        second
      )
    );
  }
);

test(
  "signing payload rejects non-object manifests and malformed signature containers",
  () => {
    assert.throws(
      () =>
        createPackageSigningPayload(
          null
        ),
      TypeError
    );

    assert.throws(
      () =>
        createPackageSigningPayload({
          id:
            "example",
          signature:
            "not-an-object",
        }),
      TypeError
    );
  }
);