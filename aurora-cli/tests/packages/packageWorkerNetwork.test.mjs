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
  PackageNetworkBroker,
} from "../../dist/packages/execution/packageNetworkBroker.js";

import {
  PackageWorker,
} from "../../dist/packages/installation/packageWorker.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  PackageTrustPolicy,
} from "../../dist/packages/trust/packageTrustPolicy.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

const PUBLISHER_ID =
  "aurora-tests";

const ORIGIN =
  "https://api.example.com";

function unsignedTrust() {
  return new PackageTrustPolicy({
    requireSignatures:
      false,
  });
}

async function createProject() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-worker-network-project-"
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
          "aurora-worker-network-test",
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

async function createPackage(
  id,
  source,
  methods
) {
  const packageRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-worker-network-package-"
      )
    );

  const packageDirectory =
    join(
      packageRoot,
      id
    );

  await mkdir(
    packageDirectory,
    {
      recursive: true,
    }
  );

  await writeFile(
    join(
      packageDirectory,
      "install.js"
    ),
    source,
    "utf8"
  );

  await writePackageManifestV1(
    packageDirectory,
    {
      id,
      name: id,

      capabilities: [
        "package.code.execute",
        "network.access",
      ],

      networkAccess: [
        {
          origin:
            ORIGIN,
          methods,
        },
      ],
    }
  );

  return {
    packageRoot,
    packageDirectory,
  };
}

function createExecutionPolicy(
  packageId,
  methods
) {
  return {
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
  };
}

function createNetworkHarness(
  executionPolicy,
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
        new PackageCapabilityPolicy(
          executionPolicy
        ),

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
            responseBody.length > 0
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

function createWorker(
  packageRoot,
  executionPolicy,
  networkBroker
) {
  return new PackageWorker(
    packageRoot,
    executionPolicy,
    unsignedTrust(),
    undefined,
    undefined,
    networkBroker
  );
}

test(
  "PackageWorker carries authorized network access through the production execution path",
  async () => {
    const id =
      "worker-network-authorized";

    const methods = [
      "POST",
    ];

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        id,
        `
export async function install(context) {
  const response =
    await context.network.request({
      url:
        "https://api.example.com/v1/install?q=aurora",
      method:
        "POST",
      headers: {
        "X-Aurora-Worker":
          "phase-5b-c",
      },
      body:
        "worker-payload",
    });

  if (
    response.status !== 201 ||
    response.body !== "worker-ok" ||
    response.headers.length !== 1 ||
    response.headers[0].name !==
      "Content-Type" ||
    response.headers[0].value !==
      "text/plain"
  ) {
    throw new Error(
      "Unexpected PackageWorker network response."
    );
  }
}
`,
        methods
      );

    const executionPolicy =
      createExecutionPolicy(
        id,
        methods
      );

    const harness =
      createNetworkHarness(
        executionPolicy,
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
                "must-not-reach-package=value",
            },
          ],

          responseBody:
            "worker-ok",
        }
      );

    const worker =
      createWorker(
        packageArtifact
          .packageRoot,
        executionPolicy,
        harness.broker
      );

    try {
      await worker.install(
        id,
        new InstallerContext(
          projectRoot
        )
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
        "/v1/install?q=aurora"
      );

      assert.equal(
        request.method,
        "POST"
      );

      assert.equal(
        request.headers[
          "X-Aurora-Worker"
        ],
        "phase-5b-c"
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
        "worker-payload"
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
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "PackageWorker denies a network method outside the manifest and trusted host grant before DNS",
  async () => {
    const id =
      "worker-network-method-denied";

    const methods = [
      "GET",
    ];

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        id,
        `
export async function install(context) {
  await context.network.request({
    url:
      "https://api.example.com/install",
    method:
      "POST",
    body:
      "must-not-leave-host",
  });
}
`,
        methods
      );

    const executionPolicy =
      createExecutionPolicy(
        id,
        methods
      );

    const harness =
      createNetworkHarness(
        executionPolicy
      );

    const worker =
      createWorker(
        packageArtifact
          .packageRoot,
        executionPolicy,
        harness.broker
      );

    try {
      await assert.rejects(
        worker.install(
          id,
          new InstallerContext(
            projectRoot
          )
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
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "PackageWorker network authority does not restore direct fetch",
  async () => {
    const id =
      "worker-network-direct-fetch";

    const methods = [
      "GET",
    ];

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        id,
        `
export async function install() {
  await fetch(
    "https://api.example.com/"
  );
}
`,
        methods
      );

    const executionPolicy =
      createExecutionPolicy(
        id,
        methods
      );

    const harness =
      createNetworkHarness(
        executionPolicy
      );

    const worker =
      createWorker(
        packageArtifact
          .packageRoot,
        executionPolicy,
        harness.broker
      );

    try {
      await assert.rejects(
        worker.install(
          id,
          new InstallerContext(
            projectRoot
          )
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
        packageArtifact
          .packageRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
