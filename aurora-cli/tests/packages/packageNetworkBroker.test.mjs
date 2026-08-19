import test from "node:test";
import assert from "node:assert/strict";

import {
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

import {
  PACKAGE_NETWORK_CONCURRENCY_MAX,
  PACKAGE_NETWORK_INBOUND_LIFECYCLE_MAX_BYTES,
  PACKAGE_NETWORK_OUTBOUND_LIFECYCLE_MAX_BYTES,
  PACKAGE_NETWORK_REQUEST_BODY_MAX_BYTES,
  PACKAGE_NETWORK_REQUEST_MAX,
  PACKAGE_NETWORK_REQUEST_TIMEOUT_MS,
  PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES,
  PackageNetworkBroker,
} from "../../dist/packages/execution/packageNetworkBroker.js";

function manifest(
  {
    origin = "https://api.example.com",
    methods = [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ],
  } = {}
) {
  return {
    id:
      "network-test-package",
    publisher: {
      id: "aurora-tests",
      name: "Aurora Tests",
    },
    capabilities: [
      "network.access",
    ],
    networkAccess: [
      {
        origin,
        methods,
      },
    ],
  };
}

function createPolicy(
  {
    origin = "https://api.example.com",
    methods = [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ],
  } = {}
) {
  return new PackageCapabilityPolicy({
    packageNetworkGrants: [
      {
        publisherId:
          "aurora-tests",
        packageId:
          "network-test-package",
        origin,
        methods,
      },
    ],
  });
}

function createHarness(
  {
    policy = createPolicy(),
    resolution = [
      {
        address:
          "93.184.216.34",
        family: 4,
      },
    ],
    resolverError,
    transportError,
    status = 200,
    responseHeaders = [],
    responseChunks = [],
    transportHandler,
  } = {}
) {
  let resolverCalls = 0;

  const transportCalls = [];

  const resolver = {
    async lookup() {
      resolverCalls += 1;

      if (resolverError) {
        throw resolverError;
      }

      return resolution;
    },
  };

  const transport = {
    async request(input) {
      transportCalls.push(input);

      if (transportError) {
        throw transportError;
      }

      input.onResponseHead(
        status,
        responseHeaders
      );

      if (transportHandler) {
        await transportHandler(input);
        return;
      }

      for (const chunk of responseChunks) {
        input.onBodyChunk(chunk);
      }
    },
  };

  const broker =
    new PackageNetworkBroker({
      accessPolicy:
        policy,
      resolver,
      transport,
    });

  return {
    broker,
    transportCalls,
    getResolverCalls() {
      return resolverCalls;
    },
  };
}

test(
  "authorized request is admitted before DNS then pinned into bounded transport",
  async () => {
    const harness =
      createHarness({
        resolution: [
          {
            address:
              "93.184.216.34",
            family: 4,
          },
          {
            address: "1.1.1.1",
            family: 4,
          },
        ],
        responseHeaders: [
          {
            name: "Content-Type",
            value: "text/plain",
          },
          {
            name: "Set-Cookie",
            value: "ambient=value",
          },
          {
            name: "Connection",
            value: "keep-alive",
          },
        ],
        responseChunks: [
          Buffer.from("hello"),
        ],
      });

    const response =
      await harness.broker
        .createSession(manifest())
        .request({
          url:
            "https://api.example.com/v1/items?q=1",
          method: "GET",
          headers: {
            Accept: "text/plain",
          },
        });

    assert.equal(response.status, 200);
    assert.equal(response.body, "hello");

    assert.deepEqual(
      response.headers,
      [
        {
          name: "Content-Type",
          value: "text/plain",
        },
      ]
    );

    assert.equal(
      harness.getResolverCalls(),
      1
    );

    assert.equal(
      harness.transportCalls.length,
      1
    );

    const outbound =
      harness.transportCalls[0];

    assert.equal(
      outbound.hostname,
      "api.example.com"
    );

    assert.equal(
      outbound.port,
      443
    );

    assert.equal(
      outbound.path,
      "/v1/items?q=1"
    );

    assert.deepEqual(
      outbound.address,
      {
        address:
          "93.184.216.34",
        family: 4,
      }
    );

    assert.equal(
      outbound.headers[
        "Accept-Encoding"
      ],
      "identity"
    );

    assert.ok(
      outbound.timeoutMs > 0
    );

    assert.ok(
      outbound.timeoutMs <=
        PACKAGE_NETWORK_REQUEST_TIMEOUT_MS
    );
  }
);

test(
  "exact non-default HTTPS port remains part of network authority",
  async () => {
    const origin =
      "https://api.example.com:8443";

    const harness =
      createHarness({
        policy:
          createPolicy({ origin }),
      });

    await harness.broker
      .createSession(
        manifest({ origin })
      )
      .request({
        url:
          "https://api.example.com:8443/data",
        method: "GET",
      });

    assert.equal(
      harness.transportCalls[0].port,
      8443
    );
  }
);

test(
  "authorization denial happens before DNS and transport",
  async () => {
    const harness =
      createHarness();

    await assert.rejects(
      () => harness.broker
        .createSession(manifest())
        .request({
          url:
            "https://other.example.com/data",
          method: "GET",
        }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        return true;
      }
    );

    assert.equal(
      harness.getResolverCalls(),
      0
    );

    assert.equal(
      harness.transportCalls.length,
      0
    );
  }
);

test(
  "one unsafe DNS answer poisons the entire resolution before transport",
  async () => {
    const harness =
      createHarness({
        resolution: [
          {
            address:
              "93.184.216.34",
            family: 4,
          },
          {
            address: "127.0.0.1",
            family: 4,
          },
        ],
      });

    await assert.rejects(
      () => harness.broker
        .createSession(manifest())
        .request({
          url:
            "https://api.example.com/",
          method: "GET",
        }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_PERMISSION_DENIED"
        );
        return true;
      }
    );

    assert.equal(
      harness.transportCalls.length,
      0
    );
  }
);

test(
  "DNS failure and empty resolution fail closed",
  async () => {
    for (const options of [
      {
        resolverError:
          new Error("dns failed"),
      },
      {
        resolution: [],
      },
    ]) {
      const harness =
        createHarness(options);

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );
    }
  }
);

test(
  "HTTP IP literals credentials fragments and unsupported methods fail closed",
  async () => {
    const requests = [
      {
        url:
          "http://api.example.com/",
        method: "GET",
      },
      {
        url:
          "https://127.0.0.1/",
        method: "GET",
      },
      {
        url:
          "https://[::1]/",
        method: "GET",
      },
      {
        url:
          "https://user:pass@api.example.com/",
        method: "GET",
      },
      {
        url:
          "https://api.example.com/#fragment",
        method: "GET",
      },
      {
        url:
          "https://api.example.com/",
        method: "OPTIONS",
      },
      {
        url:
          "https://api.example.com/",
        method: "get",
      },
    ];

    for (const request of requests) {
      const harness =
        createHarness();

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request(request),
        error => {
          assert.ok(
            error.code ===
              "PACKAGE_PERMISSION_DENIED" ||
            error.code ===
              "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );

      assert.equal(
        harness.transportCalls.length,
        0
      );
    }
  }
);

test(
  "ambient and transport-sensitive package headers are denied",
  async () => {
    for (const name of [
      "Host",
      "Connection",
      "Content-Length",
      "Transfer-Encoding",
      "TE",
      "Trailer",
      "Upgrade",
      "Proxy-Authorization",
      "Proxy-Connection",
      "Cookie",
      "Accept-Encoding",
      "Forwarded",
      "X-Forwarded-For",
      "X-Forwarded-Host",
      "X-Forwarded-Proto",
      "Via",
    ]) {
      const harness =
        createHarness();

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
            headers: {
              [name]: "value",
            },
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );
          return true;
        }
      );
    }
  }
);

test(
  "Authorization is permitted only as explicit package-provided data",
  async () => {
    const harness =
      createHarness();

    await harness.broker
      .createSession(manifest())
      .request({
        url:
          "https://api.example.com/",
        method: "GET",
        headers: {
          Authorization:
            "Bearer package-value",
        },
      });

    assert.equal(
      harness.transportCalls[0]
        .headers.Authorization,
      "Bearer package-value"
    );
  }
);

test(
  "malformed duplicate and oversized request headers fail closed",
  async () => {
    const countHeaders =
      Object.fromEntries(
        Array.from(
          { length: 33 },
          (_, index) => [
            `X-H${index}`,
            "v",
          ]
        )
      );

    const aggregateHeaders =
      Object.fromEntries(
        Array.from(
          { length: 3 },
          (_, index) => [
            `X-L${index}`,
            "a".repeat(6000),
          ]
        )
      );

    const cases = [
      {
        headers: {
          "Bad Header": "x",
        },
      },
      {
        headers: {
          Example: "a\r\nb",
        },
      },
      {
        headers: {
          Example: "a\0b",
        },
      },
      {
        headers: {
          Example: "one",
          example: "two",
        },
      },
      { headers: countHeaders },
      {
        headers: {
          Example:
            "a".repeat(8193),
        },
      },
      { headers: aggregateHeaders },
    ];

    for (const candidate of cases) {
      const harness =
        createHarness();

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
            ...candidate,
          }),
        error => {
          assert.ok(
            error.code ===
              "PACKAGE_NETWORK_FAILED" ||
            error.code ===
              "PACKAGE_NETWORK_LIMIT"
          );
          return true;
        }
      );
    }
  }
);

test(
  "GET and HEAD bodies plus oversized URLs and bodies are rejected",
  async () => {
    for (const method of [
      "GET",
      "HEAD",
    ]) {
      const harness =
        createHarness();

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method,
            body: "x",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );
    }

    {
      const harness =
        createHarness();

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/" +
              "x".repeat(8192),
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_LIMIT"
          );
          return true;
        }
      );
    }

    {
      const harness =
        createHarness();

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "POST",
            body:
              "a".repeat(
                PACKAGE_NETWORK_REQUEST_BODY_MAX_BYTES +
                1
              ),
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_LIMIT"
          );
          return true;
        }
      );
    }
  }
);

test(
  "host constructs Content-Length for bounded request bodies",
  async () => {
    const harness =
      createHarness();

    await harness.broker
      .createSession(manifest())
      .request({
        url:
          "https://api.example.com/",
        method: "POST",
        body: "hello",
      });

    assert.equal(
      harness.transportCalls[0]
        .headers["Content-Length"],
      "5"
    );
  }
);

test(
  "outbound lifecycle body budget permits exactly one MiB",
  async () => {
    const harness =
      createHarness();

    const session =
      harness.broker.createSession(
        manifest()
      );

    const body =
      "a".repeat(
        PACKAGE_NETWORK_REQUEST_BODY_MAX_BYTES
      );

    for (let index = 0; index < 4; index++) {
      await session.request({
        url:
          "https://api.example.com/",
        method: "POST",
        body,
      });
    }

    assert.equal(
      4 *
        PACKAGE_NETWORK_REQUEST_BODY_MAX_BYTES,
      PACKAGE_NETWORK_OUTBOUND_LIFECYCLE_MAX_BYTES
    );

    await assert.rejects(
      () => session.request({
        url:
          "https://api.example.com/",
        method: "POST",
        body: "x",
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_NETWORK_LIMIT"
        );
        return true;
      }
    );
  }
);

test(
  "request-count lifecycle budget permits exactly thirty-two requests",
  async () => {
    const harness =
      createHarness();

    const session =
      harness.broker.createSession(
        manifest()
      );

    for (
      let index = 0;
      index < PACKAGE_NETWORK_REQUEST_MAX;
      index++
    ) {
      await session.request({
        url:
          "https://api.example.com/",
        method: "GET",
      });
    }

    await assert.rejects(
      () => session.request({
        url:
          "https://api.example.com/",
        method: "GET",
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_NETWORK_LIMIT"
        );
        return true;
      }
    );
  }
);

test(
  "concurrency is limited to four in-flight requests",
  async () => {
    const releases = [];

    const harness =
      createHarness({
        transportHandler() {
          return new Promise(
            resolve => {
              releases.push(resolve);
            }
          );
        },
      });

    const session =
      harness.broker.createSession(
        manifest()
      );

    const pending =
      Array.from(
        {
          length:
            PACKAGE_NETWORK_CONCURRENCY_MAX,
        },
        () => session.request({
          url:
            "https://api.example.com/",
          method: "GET",
        })
      );

    await new Promise(
      resolve =>
        setImmediate(resolve)
    );

    assert.equal(
      releases.length,
      PACKAGE_NETWORK_CONCURRENCY_MAX
    );

    await assert.rejects(
      () => session.request({
        url:
          "https://api.example.com/",
        method: "GET",
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_NETWORK_LIMIT"
        );
        return true;
      }
    );

    for (const release of releases) {
      release();
    }

    await Promise.all(pending);
  }
);

test(
  "one MiB response is accepted and one additional byte is denied",
  async () => {
    {
      const harness =
        createHarness({
          responseChunks: [
            Buffer.alloc(
              PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES,
              97
            ),
          ],
        });

      const response =
        await harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          });

      assert.equal(
        Buffer.byteLength(
          response.body,
          "utf8"
        ),
        PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES
      );
    }

    {
      const harness =
        createHarness({
          responseChunks: [
            Buffer.alloc(
              PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES +
              1,
              97
            ),
          ],
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_LIMIT"
          );
          return true;
        }
      );
    }
  }
);

test(
  "inbound lifecycle body budget permits exactly four MiB",
  async () => {
    let call = 0;

    const harness =
      createHarness({
        transportHandler(input) {
          call += 1;

          if (call <= 4) {
            input.onBodyChunk(
              Buffer.alloc(
                PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES,
                97
              )
            );
          }
          else {
            input.onBodyChunk(
              Buffer.from("x")
            );
          }
        },
      });

    const session =
      harness.broker.createSession(
        manifest()
      );

    for (let index = 0; index < 4; index++) {
      await session.request({
        url:
          "https://api.example.com/",
        method: "GET",
      });
    }

    assert.equal(
      4 *
        PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES,
      PACKAGE_NETWORK_INBOUND_LIFECYCLE_MAX_BYTES
    );

    await assert.rejects(
      () => session.request({
        url:
          "https://api.example.com/",
        method: "GET",
      }),
      error => {
        assert.equal(
          error.code,
          "PACKAGE_NETWORK_LIMIT"
        );
        return true;
      }
    );
  }
);

test(
  "invalid UTF-8 and compressed responses fail closed",
  async () => {
    {
      const harness =
        createHarness({
          responseChunks: [
            Buffer.from([
              0xc3,
              0x28,
            ]),
          ],
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );
    }

    {
      const harness =
        createHarness({
          responseHeaders: [
            {
              name:
                "Content-Encoding",
              value: "gzip",
            },
          ],
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );
    }
  }
);

test(
  "redirects are ordinary responses and sensitive headers are filtered",
  async () => {
    const harness =
      createHarness({
        status: 302,
        responseHeaders: [
          {
            name: "Location",
            value:
              "https://other.example.com/",
          },
          {
            name: "Set-Cookie",
            value: "secret=value",
          },
          {
            name: "Keep-Alive",
            value: "timeout=5",
          },
          {
            name: "X-Safe",
            value: "ok",
          },
        ],
      });

    const response =
      await harness.broker
        .createSession(manifest())
        .request({
          url:
            "https://api.example.com/",
          method: "GET",
        });

    assert.equal(
      response.status,
      302
    );

    assert.equal(
      harness.transportCalls.length,
      1
    );

    assert.deepEqual(
      response.headers,
      [
        {
          name: "Location",
          value:
            "https://other.example.com/",
        },
        {
          name: "X-Safe",
          value: "ok",
        },
      ]
    );
  }
);

test(
  "response header count and invalid response status fail closed",
  async () => {
    {
      const headers =
        Array.from(
          { length: 65 },
          (_, index) => ({
            name:
              `X-H${index}`,
            value: "v",
          })
        );

      const harness =
        createHarness({
          responseHeaders: headers,
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_LIMIT"
          );
          return true;
        }
      );
    }

    {
      const harness =
        createHarness({
          status: 99,
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );
    }
  }
);

test(
  "transport timeouts and ordinary transport failures use distinct errors",
  async () => {
    {
      const timeout =
        new Error("timeout");

      timeout.code =
        "ETIMEDOUT";

      const harness =
        createHarness({
          transportError: timeout,
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_TIMEOUT"
          );
          return true;
        }
      );
    }

    {
      const harness =
        createHarness({
          transportError:
            new Error("tls failed"),
        });

      await assert.rejects(
        () => harness.broker
          .createSession(manifest())
          .request({
            url:
              "https://api.example.com/",
            method: "GET",
          }),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_NETWORK_FAILED"
          );
          return true;
        }
      );
    }
  }
);
