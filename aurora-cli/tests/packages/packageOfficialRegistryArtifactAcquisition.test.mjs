import assert from "node:assert/strict";

import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";

import fs from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import test from "node:test";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  OfficialRegistryArtifactAcquirer,
  assertVerifiedOfficialRegistryArtifact,
} from "../../dist/packages/registry/officialRegistryArtifactAcquirer.js";

import {
  createOfficialRegistrySigningPayload,
} from "../../dist/packages/registry/officialRegistrySigningPayload.js";

import {
  AURORA_OFFICIAL_PUBLISHER_ID,
} from "../../dist/packages/trust/officialPublisherTrust.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

function sha256(
  value
) {
  return createHash(
    "sha256"
  ).update(
    value
  ).digest(
    "hex"
  );
}

function createAuthority() {
  const {
    publicKey,
    privateKey,
  } =
    generateKeyPairSync(
      "ed25519"
    );

  return {
    privateKey,

    publicKey:
      encodeEd25519PublicKeySpki(
        publicKey
      ),

    keyId:
      fingerprintEd25519PublicKey(
        publicKey
      ),
  };
}

function createRegistryOptions(
  authority
) {
  return {
    verifierOptions: {
      trustStore:
        new PackageTrustStore([
          {
            id:
              AURORA_OFFICIAL_PUBLISHER_ID,

            status:
              "trusted",

            keys: [
              {
                algorithm:
                  "ed25519",

                publicKey:
                  authority.publicKey,

                status:
                  "trusted",
              },
            ],
          },
        ]),
    },
  };
}

function createEntry(
  packageId,
  version,
  body,
  overrides = {}
) {
  const base = {
    packageId,
    version,
    manifestDigest:
      "1".repeat(64),

    archive: {
      algorithm:
        "sha256",

      digest:
        sha256(body),

      size:
        body.byteLength,

      url:
        `https://registry.aurora.example/packages/${packageId}/${version}.tgz?source=official`,
    },

    provenance: {
      type:
        "build",

      url:
        "https://github.com/sanchu-dodu/aurora",

      reference:
        `${packageId}@${version}`,
    },

    lifecycle: {
      status:
        "active",
    },
  };

  return {
    ...base,
    ...overrides,

    archive: {
      ...base.archive,
      ...(
        overrides.archive ??
        {}
      ),
    },

    provenance: {
      ...base.provenance,
      ...(
        overrides.provenance ??
        {}
      ),
    },

    lifecycle: {
      ...base.lifecycle,
      ...(
        overrides.lifecycle ??
        {}
      ),
    },
  };
}

function signSnapshot(
  authority,
  packages
) {
  const candidate = {
    registryVersion:
      1,

    kind:
      "aurora-official-package-registry",

    sequence:
      1,

    publishedAt:
      "2026-08-24T10:15:00.000Z",

    previousSnapshotDigest:
      null,

    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,

    packages,

    signature: {
      version:
        1,

      algorithm:
        "ed25519",

      keyId:
        authority.keyId,

      value:
        "A".repeat(86),
    },
  };

  return {
    ...candidate,

    signature: {
      ...candidate.signature,

      value:
        sign(
          null,
          createOfficialRegistrySigningPayload(
            candidate
          ),
          authority.privateKey
        ).toString(
          "base64url"
        ),
    },
  };
}

async function createQuarantineRoot(
  context
) {
  const root =
    await fs.mkdtemp(
      join(
        tmpdir(),
        "aurora-registry-acquisition-test-"
      )
    );

  context.after(
    async () => {
      await fs.rm(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  );

  return root;
}

function createHarness(
  authority,
  snapshot,
  quarantineRoot,
  body,
  overrides = {}
) {
  const state = {
    addressCalls:
      0,
    transportCalls:
      [],
  };

  const addressResolver =
    overrides.addressResolver ??
    {
      async lookup() {
        state.addressCalls +=
          1;

        return [
          {
            address:
              "93.184.216.34",
            family:
              4,
          },
        ];
      },
    };

  const transport =
    overrides.transport ??
    {
      async request(input) {
        state.transportCalls.push(
          input
        );

        input.onResponseHead(
          200,
          [
            {
              name:
                "Content-Length",
              value:
                String(
                  body.byteLength
                ),
            },
            {
              name:
                "Content-Encoding",
              value:
                "identity",
            },
          ]
        );

        const midpoint =
          Math.max(
            1,
            Math.floor(
              body.byteLength /
                2
            )
          );

        await Promise.all([
          input.onBodyChunk(
            body.subarray(
              0,
              midpoint
            )
          ),
          input.onBodyChunk(
            body.subarray(
              midpoint
            )
          ),
        ]);
      },
    };

  const acquirer =
    new OfficialRegistryArtifactAcquirer(
      snapshot,
      {
        registryOptions:
          createRegistryOptions(
            authority
          ),
        quarantineRoot,
        addressResolver,
        transport,
        ...(
          overrides.options ??
          {}
        ),
      }
    );

  return {
    acquirer,
    state,
  };
}

async function assertEmptyDirectory(
  directory
) {
  assert.deepEqual(
    await fs.readdir(
      directory
    ),
    []
  );
}

test(
  "verified official archive streams into quarantine and returns an authentic immutable receipt",
  async context => {
    const body =
      Buffer.from(
        "verified official package archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const root =
      await createQuarantineRoot(
        context
      );

    const harness =
      createHarness(
        authority,
        snapshot,
        root,
        body
      );

    const receipt =
      await harness.acquirer
        .acquire(
          "alpha"
        );

    assert.equal(
      receipt.resolved.entry.packageId,
      "alpha"
    );

    assert.equal(
      receipt.resolved.entry.version,
      "1.0.0"
    );

    assert.equal(
      receipt.receivedBytes,
      body.byteLength
    );

    assert.deepEqual(
      await fs.readFile(
        receipt.filePath
      ),
      body
    );

    assert.deepEqual(
      await fs.readdir(
        receipt.quarantineDirectory
      ),
      [
        "archive.bin",
      ]
    );

    assert.equal(
      Object.isFrozen(
        receipt
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        receipt.resolved
      ),
      true
    );

    assert.doesNotThrow(
      () =>
        assertVerifiedOfficialRegistryArtifact(
          receipt
        )
    );

    assert.throws(
      () =>
        assertVerifiedOfficialRegistryArtifact({
          ...receipt,
        }),
      /authentic verified official registry artifact receipt/u
    );

    assert.equal(
      harness.state.addressCalls,
      1
    );

    assert.equal(
      harness.state.transportCalls.length,
      1
    );

    const request =
      harness.state.transportCalls[0];

    assert.equal(
      request.hostname,
      "registry.aurora.example"
    );

    assert.equal(
      request.port,
      443
    );

    assert.equal(
      request.path,
      "/packages/alpha/1.0.0.tgz?source=official"
    );

    assert.deepEqual(
      request.address,
      {
        address:
          "93.184.216.34",
        family:
          4,
      }
    );
  }
);

test(
  "acquirer selects through the internal verified resolver and preserves registry binding",
  async context => {
    const oldBody =
      Buffer.from(
        "old"
      );

    const latestBody =
      Buffer.from(
        "latest"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            oldBody
          ),
          createEntry(
            "alpha",
            "2.0.0",
            latestBody
          ),
        ]
      );

    const root =
      await createQuarantineRoot(
        context
      );

    const harness =
      createHarness(
        authority,
        snapshot,
        root,
        latestBody
      );

    const receipt =
      await harness.acquirer
        .acquire(
          "alpha",
          {
            kind:
              "range",
            range:
              "^2.0.0",
          }
        );

    assert.equal(
      receipt.resolved.entry.version,
      "2.0.0"
    );

    assert.equal(
      receipt.resolved.registrySequence,
      1
    );

    assert.match(
      receipt.resolved.registryDigest,
      /^[a-f0-9]{64}$/u
    );
  }
);

test(
  "tampered registry data cannot be bypassed with a forged resolver option",
  async context => {
    const body =
      Buffer.from(
        "trusted"
      );

    const authority =
      createAuthority();

    const signed =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const tampered =
      structuredClone(
        signed
      );

    tampered.packages[0]
      .archive.digest =
        "f".repeat(64);

    const root =
      await createQuarantineRoot(
        context
      );

    let forgedResolverCalls =
      0;

    assert.throws(
      () =>
        new OfficialRegistryArtifactAcquirer(
          tampered,
          {
            registryOptions:
              createRegistryOptions(
                authority
              ),
            quarantineRoot:
              root,
            registryResolver: {
              resolve() {
                forgedResolverCalls +=
                  1;
                return {};
              },
            },
          }
        ),
      /registry verification failed/u
    );

    assert.equal(
      forgedResolverCalls,
      0
    );

    await assertEmptyDirectory(
      root
    );
  }
);

test(
  "revoked package resolution fails before DNS, transport, or quarantine",
  async context => {
    const body =
      Buffer.from(
        "revoked"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body,
            {
              lifecycle: {
                status:
                  "revoked",
                reason:
                  "Archive withdrawn.",
              },
            }
          ),
        ]
      );

    const root =
      await createQuarantineRoot(
        context
      );

    const harness =
      createHarness(
        authority,
        snapshot,
        root,
        body
      );

    await assert.rejects(
      () =>
        harness.acquirer
          .acquire(
            "alpha"
          ),
      /no active versions/u
    );

    assert.equal(
      harness.state.addressCalls,
      0
    );

    assert.equal(
      harness.state.transportCalls.length,
      0
    );

    await assertEmptyDirectory(
      root
    );
  }
);

test(
  "one unsafe DNS answer poisons the entire signed-origin resolution",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const root =
      await createQuarantineRoot(
        context
      );

    let transportCalls = 0;

    const harness =
      createHarness(
        authority,
        snapshot,
        root,
        body,
        {
          addressResolver: {
            async lookup() {
              return [
                {
                  address:
                    "93.184.216.34",
                  family:
                    4,
                },
                {
                  address:
                    "127.0.0.1",
                  family:
                    4,
                },
              ];
            },
          },
          transport: {
            async request() {
              transportCalls +=
                1;
            },
          },
        }
      );

    await assert.rejects(
      () =>
        harness.acquirer
          .acquire(
            "alpha"
          ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_ACQUISITION_FAILED
        );

        assert.match(
          error.message,
          /unsafe or invalid address/u
        );

        return true;
      }
    );

    assert.equal(
      transportCalls,
      0
    );

    await assertEmptyDirectory(
      root
    );
  }
);

test(
  "redirects and transformed response bodies fail closed and remove quarantine",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    for (const scenario of [
      {
        name:
          "redirect",
        status:
          302,
        headers: [
          {
            name:
              "Location",
            value:
              "https://elsewhere.example/archive.tgz",
          },
        ],
        pattern:
          /attempted an HTTP redirect/u,
      },
      {
        name:
          "content encoding",
        status:
          200,
        headers: [
          {
            name:
              "Content-Encoding",
            value:
              "gzip",
          },
        ],
        pattern:
          /transformed content encoding/u,
      },
    ]) {
      await context.test(
        scenario.name,
        async child => {
          const root =
            await createQuarantineRoot(
              child
            );

          const harness =
            createHarness(
              authority,
              snapshot,
              root,
              body,
              {
                transport: {
                  async request(input) {
                    input.onResponseHead(
                      scenario.status,
                      scenario.headers
                    );
                  },
                },
              }
            );

          await assert.rejects(
            () =>
              harness.acquirer
                .acquire(
                  "alpha"
                ),
            scenario.pattern
          );

          await assertEmptyDirectory(
            root
          );
        }
      );
    }
  }
);

test(
  "signed size is enforced at the response head, during streaming, and at end of stream",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const scenarios = [
      {
        name:
          "mismatched Content-Length",
        async run(input) {
          input.onResponseHead(
            200,
            [
              {
                name:
                  "Content-Length",
                value:
                  String(
                    body.byteLength +
                      1
                  ),
              },
            ]
          );
        },
        pattern:
          /Content-Length does not match/u,
      },
      {
        name:
          "stream too long",
        async run(input) {
          input.onResponseHead(
            200,
            []
          );

          await input.onBodyChunk(
            Buffer.concat([
              body,
              Buffer.from("x"),
            ])
          );
        },
        pattern:
          /exceeded the signed archive size/u,
      },
      {
        name:
          "stream too short",
        async run(input) {
          input.onResponseHead(
            200,
            []
          );

          await input.onBodyChunk(
            body.subarray(
              0,
              -1
            )
          );
        },
        pattern:
          /received byte count does not match/u,
      },
    ];

    for (const scenario of scenarios) {
      await context.test(
        scenario.name,
        async child => {
          const root =
            await createQuarantineRoot(
              child
            );

          const harness =
            createHarness(
              authority,
              snapshot,
              root,
              body,
              {
                transport: {
                  request:
                    scenario.run,
                },
              }
            );

          await assert.rejects(
            () =>
              harness.acquirer
                .acquire(
                  "alpha"
                ),
            error => {
              assert.equal(
                error.code,
                ErrorCodes
                  .PACKAGE_INTEGRITY_FAILED
              );

              assert.match(
                error.message,
                scenario.pattern
              );

              return true;
            }
          );

          await assertEmptyDirectory(
            root
          );
        }
      );
    }
  }
);

test(
  "response header budgets and ambiguous lengths fail closed",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const scenarios = [
      {
        name:
          "header count",
        headers:
          Array.from(
            {
              length:
                65,
            },
            (_, index) => ({
              name:
                `X-Aurora-${index}`,
              value:
                "value",
            })
          ),
        code:
          ErrorCodes
            .PACKAGE_ACQUISITION_LIMIT,
      },
      {
        name:
          "header bytes",
        headers: [
          {
            name:
              "X-Large",
            value:
              "x".repeat(
                33 * 1024
              ),
          },
        ],
        code:
          ErrorCodes
            .PACKAGE_ACQUISITION_LIMIT,
      },
      {
        name:
          "duplicate Content-Length",
        headers: [
          {
            name:
              "Content-Length",
            value:
              String(
                body.byteLength
              ),
          },
          {
            name:
              "content-length",
            value:
              String(
                body.byteLength
              ),
          },
        ],
        code:
          ErrorCodes
            .PACKAGE_ACQUISITION_FAILED,
      },
    ];

    for (const scenario of scenarios) {
      await context.test(
        scenario.name,
        async child => {
          const root =
            await createQuarantineRoot(
              child
            );

          const harness =
            createHarness(
              authority,
              snapshot,
              root,
              body,
              {
                transport: {
                  async request(input) {
                    input.onResponseHead(
                      200,
                      scenario.headers
                    );
                  },
                },
              }
            );

          await assert.rejects(
            () =>
              harness.acquirer
                .acquire(
                  "alpha"
                ),
            error => {
              assert.equal(
                error.code,
                scenario.code
              );

              return true;
            }
          );

          await assertEmptyDirectory(
            root
          );
        }
      );
    }
  }
);

test(
  "same-size tampering fails SHA-256 verification and removes quarantine",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const tampered =
      Buffer.from(
        "archivf"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const root =
      await createQuarantineRoot(
        context
      );

    const harness =
      createHarness(
        authority,
        snapshot,
        root,
        tampered
      );

    await assert.rejects(
      () =>
        harness.acquirer
          .acquire(
            "alpha"
          ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
        );

        assert.match(
          error.message,
          /SHA-256 digest does not match/u
        );

        return true;
      }
    );

    await assertEmptyDirectory(
      root
    );
  }
);

test(
  "host archive limit rejects signed oversized metadata before DNS or disk writes",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    const root =
      await createQuarantineRoot(
        context
      );

    const harness =
      createHarness(
        authority,
        snapshot,
        root,
        body,
        {
          options: {
            maxArchiveBytes:
              body.byteLength -
                1,
          },
        }
      );

    await assert.rejects(
      () =>
        harness.acquirer
          .acquire(
            "alpha"
          ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_ACQUISITION_LIMIT
        );

        return true;
      }
    );

    assert.equal(
      harness.state.addressCalls,
      0
    );

    assert.equal(
      harness.state.transportCalls.length,
      0
    );

    await assertEmptyDirectory(
      root
    );
  }
);

test(
  "DNS and HTTPS deadline failures are distinct and leave no quarantined bytes",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    await context.test(
      "DNS deadline",
      async child => {
        const root =
          await createQuarantineRoot(
            child
          );

        const harness =
          createHarness(
            authority,
            snapshot,
            root,
            body,
            {
              addressResolver: {
                lookup() {
                  return new Promise(
                    () => undefined
                  );
                },
              },
              options: {
                timeoutMs:
                  10,
              },
            }
          );

        await assert.rejects(
          () =>
            harness.acquirer
              .acquire(
                "alpha"
              ),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_ACQUISITION_TIMEOUT
            );

            return true;
          }
        );

        await assertEmptyDirectory(
          root
        );
      }
    );

    await context.test(
      "HTTPS deadline",
      async child => {
        const root =
          await createQuarantineRoot(
            child
          );


        let observedAbort =
          false;

        const harness =
          createHarness(
            authority,
            snapshot,
            root,
            body,
            {
              transport: {
                async request(input) {
                  input.onResponseHead(
                    200,
                    []
                  );

                  await new Promise(
                    (_resolve, reject) => {
                      input.signal
                        .addEventListener(
                          "abort",
                          () => {
                            observedAbort =
                              true;

                            const error =
                              new Error(
                                "transport timed out"
                              );

                            error.code =
                              "ETIMEDOUT";

                            reject(error);
                          },
                          {
                            once: true,
                          }
                        );
                    }
                  );
                },
              },
              options: {
                timeoutMs:
                  10,
              },
            }
          );

        await assert.rejects(
          () =>
            harness.acquirer
              .acquire(
                "alpha"
              ),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_ACQUISITION_TIMEOUT
            );

            return true;
          }
        );

        assert.equal(
          observedAbort,
          true
        );

        await assertEmptyDirectory(
          root
        );
      }
    );
  }
);

test(
  "transport protocol violations fail closed and clean quarantine",
  async context => {
    const body =
      Buffer.from(
        "archive"
      );

    const authority =
      createAuthority();

    const snapshot =
      signSnapshot(
        authority,
        [
          createEntry(
            "alpha",
            "1.0.0",
            body
          ),
        ]
      );

    for (const scenario of [
      {
        name:
          "body before head",
        async run(input) {
          await input.onBodyChunk(
            body
          );
        },
        pattern:
          /bytes before a response head/u,
      },
      {
        name:
          "multiple heads",
        async run(input) {
          input.onResponseHead(
            200,
            []
          );

          input.onResponseHead(
            200,
            []
          );
        },
        pattern:
          /multiple response heads/u,
      },
      {
        name:
          "no head",
        async run() {},
        pattern:
          /no response head/u,
      },
    ]) {
      await context.test(
        scenario.name,
        async child => {
          const root =
            await createQuarantineRoot(
              child
            );

          const harness =
            createHarness(
              authority,
              snapshot,
              root,
              body,
              {
                transport: {
                  request:
                    scenario.run,
                },
              }
            );

          await assert.rejects(
            () =>
              harness.acquirer
                .acquire(
                  "alpha"
                ),
            scenario.pattern
          );

          await assertEmptyDirectory(
            root
          );
        }
      );
    }
  }
);
