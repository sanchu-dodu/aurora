import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

import {
  PackageExecutionHost,
} from "../../dist/packages/execution/packageExecutionHost.js";

import {
  PackageNetworkBroker,
} from "../../dist/packages/execution/packageNetworkBroker.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

const PUBLISHER_ID =
  "aurora-tests";

const ORIGIN =
  "https://api.example.com";

async function createProject() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-network-project-"
      )
    );

  await writeFile(
    join(
      root,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          "package-network-test",
        version:
          "1.0.0",
        private: true,
        type: "module",
        dependencies: {},
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return root;
}

async function createPackageRoot(
  id,
  source
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-network-artifact-"
      )
    );

  const directory =
    join(
      root,
      id
    );

  await mkdir(
    directory,
    {
      recursive: true,
    }
  );

  await writeFile(
    join(
      directory,
      "install.js"
    ),
    source,
    "utf8"
  );

  return root;
}

function executionManifest(
  id,
  methods
) {
  return {
    id,
    publisher: {
      id:
        PUBLISHER_ID,
      name:
        "Aurora Tests",
    },
    capabilities: [
      "package.code.execute",
      "network.access",
    ],
    environment: [],
    networkAccess: [
      {
        origin:
          ORIGIN,
        methods,
      },
    ],
  };
}

function createPolicy(
  packageId,
  methods
) {
  return new PackageCapabilityPolicy({
    packageNetworkGrants: [
      {
        publisherId:
          PUBLISHER_ID,
        packageId,
        origin:
          ORIGIN,
        methods,
      },
    ],
  });
}

function createNetworkHarness(
  policy,
  {
    status = 200,
    responseHeaders = [],
    responseBody = "",
  } = {}
) {
  let resolverCalls = 0;

  const transportCalls = [];

  const broker =
    new PackageNetworkBroker({
      accessPolicy:
        policy,

      resolver: {
        async lookup() {
          resolverCalls += 1;

          return [
            {
              address:
                "93.184.216.34",
              family: 4,
            },
          ];
        },
      },

      transport: {
        async request(
          input
        ) {
          transportCalls.push(
            input
          );

          input.onResponseHead(
            status,
            responseHeaders
          );

          if (
            responseBody.length >
            0
          ) {
            input.onBodyChunk(
              Buffer.from(
                responseBody,
                "utf8"
              )
            );
          }
        },
      },
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
  "package worker brokers authorized HTTPS text requests through the host network session",
  async () => {
    const packageId =
      "network-success-package";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        packageId,
        `
export async function install(context) {
  const response =
    await context.network.request({
      url:
        "https://api.example.com/v1/items?q=1",
      method: "POST",
      headers: {
        "X-Aurora-Test": "worker",
      },
      body: "payload",
    });

  if (
    response.status !== 201 ||
    response.body !== "accepted" ||
    response.headers.length !== 1 ||
    response.headers[0].name !==
      "Content-Type" ||
    response.headers[0].value !==
      "text/plain"
  ) {
    throw new Error(
      "Unexpected brokered network response."
    );
  }
}
`
      );

    const methods = [
      "GET",
      "POST",
    ];

    const policy =
      createPolicy(
        packageId,
        methods
      );

    const harness =
      createNetworkHarness(
        policy,
        {
          status: 201,
          responseHeaders: [
            {
              name:
                "Content-Type",
              value:
                "text/plain",
            },
            {
              name:
                "Set-Cookie",
              value:
                "secret=value",
            },
          ],
          responseBody:
            "accepted",
        }
      );

    const host =
      new PackageExecutionHost(
        policy,
        undefined,
        undefined,
        undefined,
        harness.broker
      );

    const context =
      new InstallerContext(
        projectRoot
      );

    try {
      const result =
        await host.run(
          executionManifest(
            packageId,
            methods
          ),
          packageRoot,
          "install.js",
          "install",
          context
        );

      assert.equal(
        result.executed,
        true
      );

      assert.equal(
        harness.getResolverCalls(),
        1
      );

      assert.equal(
        harness.transportCalls.length,
        1
      );

      const request =
        harness.transportCalls[0];

      assert.equal(
        request.hostname,
        "api.example.com"
      );

      assert.equal(
        request.port,
        443
      );

      assert.equal(
        request.path,
        "/v1/items?q=1"
      );

      assert.equal(
        request.method,
        "POST"
      );

      assert.equal(
        request.headers[
          "X-Aurora-Test"
        ],
        "worker"
      );

      assert.equal(
        request.headers[
          "Accept-Encoding"
        ],
        "identity"
      );

      assert.equal(
        request.body.toString(
          "utf8"
        ),
        "payload"
      );

      assert.equal(
        request.address.address,
        "93.184.216.34"
      );

      assert.equal(
        request.address.family,
        4
      );
    }
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "package worker network requests cannot exceed the declared method grant",
  async () => {
    const packageId =
      "network-method-denied-package";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        packageId,
        `
export async function install(context) {
  await context.network.request({
    url:
      "https://api.example.com/items",
    method: "POST",
    body: "forbidden",
  });
}
`
      );

    const methods = [
      "GET",
    ];

    const policy =
      createPolicy(
        packageId,
        methods
      );

    const harness =
      createNetworkHarness(
        policy
      );

    const host =
      new PackageExecutionHost(
        policy,
        undefined,
        undefined,
        undefined,
        harness.broker
      );

    const context =
      new InstallerContext(
        projectRoot
      );

    try {
      await assert.rejects(
        host.run(
          executionManifest(
            packageId,
            methods
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          assert.match(
            error.message,
            /network|POST/i
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
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "network capability does not restore direct worker fetch access",
  async () => {
    const packageId =
      "network-direct-fetch-package";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot(
        packageId,
        `
export async function install() {
  await fetch(
    "https://api.example.com/"
  );
}
`
      );

    const methods = [
      "GET",
    ];

    const policy =
      createPolicy(
        packageId,
        methods
      );

    const harness =
      createNetworkHarness(
        policy
      );

    const host =
      new PackageExecutionHost(
        policy,
        undefined,
        undefined,
        undefined,
        harness.broker
      );

    const context =
      new InstallerContext(
        projectRoot
      );

    try {
      await assert.rejects(
        host.run(
          executionManifest(
            packageId,
            methods
          ),
          packageRoot,
          "install.js",
          "install",
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_EXECUTION_FAILED"
          );

          assert.match(
            error.message,
            /Direct network access is not allowed/
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
    finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
