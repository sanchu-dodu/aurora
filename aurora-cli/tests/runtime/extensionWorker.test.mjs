import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  validateExtensionManifest,
} from "../../dist/runtime/extensions/extensionManifest.js";

import {
  createExtensionWorkerArgs,
  ExtensionWorkerHost,
} from "../../dist/runtime/extensions/extensionWorkerHost.js";

function createManifest(
  overrides = {}
) {
  return {
    manifestVersion: 1,
    kind: "extension",
    id:
      overrides.id ??
      "test-extension",
    name:
      overrides.name ??
      "Test Extension",
    version:
      overrides.version ??
      "1.0.0",
    entry:
      overrides.entry ??
      "extension.js",
    trust:
      overrides.trust ??
      "built-in",
    capabilities:
      overrides.capabilities ?? [],
    limits:
      overrides.limits ?? {
        timeoutMs: 2000,
        maxOldGenerationSizeMb: 32,
        maxOutputBytes: 8192,
      },
    ...overrides,
  };
}

async function createExtension(
  source
) {
  const extensionRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-extension-worker-"
      )
    );

  await writeFile(
    join(
      extensionRoot,
      "extension.js"
    ),
    source,
    "utf8"
  );

  return extensionRoot;
}

async function withExtension(
  source,
  run
) {
  const extensionRoot =
    await createExtension(source);

  try {
    return await run(extensionRoot);
  } finally {
    await rm(
      extensionRoot,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

function hasCode(expectedCode) {
  return error => {
    assert.equal(
      error.code,
      expectedCode
    );

    return true;
  };
}

test(
  "Extension Manifest v1 is strict, canonical, and deny-by-default",
  () => {
    const valid =
      validateExtensionManifest(
        createManifest()
      );

    assert.equal(
      valid.manifestVersion,
      1
    );

    const invalidManifests = [
      createManifest({
        unknown: true,
      }),
      createManifest({
        id: "../unsafe",
      }),
      createManifest({
        entry: "../outside.js",
      }),
      createManifest({
        version: "latest",
      }),
      createManifest({
        capabilities: [
          "aurora.output.write",
          "aurora.output.write",
        ],
      }),
      createManifest({
        limits: {
          timeoutMs: 0,
          maxOldGenerationSizeMb: 1,
          maxOutputBytes: 1,
        },
      }),
    ];

    for (
      const manifest
      of invalidManifests
    ) {
      assert.throws(
        () =>
          validateExtensionManifest(
            manifest
          ),
        hasCode(
          ErrorCodes
            .INVALID_EXTENSION_MANIFEST
        )
      );
    }
  }
);

test(
  "worker launch arguments enforce memory and deny privileged runtime access",
  () => {
    const args =
      createExtensionWorkerArgs(
        createManifest({
          limits: {
            timeoutMs: 2000,
            maxOldGenerationSizeMb: 48,
            maxOutputBytes: 8192,
          },
        }),
        "C:\\aurora\\worker",
        "C:\\aurora\\extension",
        "C:\\aurora\\worker\\runtime.js",
        "C:\\aurora\\extension\\extension.js",
        8192,
        "activate"
      );

    assert.ok(
      args.includes("--permission")
    );
    assert.ok(
      args.includes(
        "--max-old-space-size=48"
      )
    );
    assert.equal(
      args.some(
        argument =>
          argument.startsWith(
            "--allow-fs-write"
          )
      ),
      false
    );

    for (const forbidden of [
      "--allow-addons",
      "--allow-child-process",
      "--allow-wasi",
      "--allow-worker",
    ]) {
      assert.equal(
        args.includes(forbidden),
        false
      );
    }
  }
);

test(
  "extension workers receive only brokered output and explicit environment values",
  async () => {
    const environmentName =
      "AURORA_EXTENSION_TEST_SECRET";
    const originalValue =
      process.env[environmentName];

    process.env[environmentName] =
      "must-not-cross-worker-boundary";

    try {
      await withExtension(
        `export async function activate(context) {
          const direct = process.env.${environmentName} ?? "scrubbed";
          const brokered = await context.environment.read("PUBLIC_TEST_VALUE");
          await context.output.write(\`direct=\${direct};brokered=\${brokered}\`);
          return "completed";
        }`,
        async extensionRoot => {
          const output = [];
          const host =
            new ExtensionWorkerHost();

          const result =
            await host.run(
              createManifest({
                capabilities: [
                  "aurora.output.write",
                  "host.environment.read",
                ],
              }),
              extensionRoot,
              "activate",
              {
                policy: {
                  allowedCapabilities: [
                    "aurora.output.write",
                    "host.environment.read",
                  ],
                  environment: {
                    PUBLIC_TEST_VALUE:
                      "visible",
                  },
                },
                writeOutput(message) {
                  output.push(message);
                },
              }
            );

          assert.equal(
            result.value,
            "completed"
          );
          assert.deepEqual(
            output,
            [
              "direct=scrubbed;brokered=[REDACTED]",
            ]
          );
          assert.equal(
            result.stdout,
            ""
          );
          assert.equal(
            result.stderr,
            ""
          );
        }
      );
    } finally {
      if (
        originalValue ===
        undefined
      ) {
        delete process.env[
          environmentName
        ];
      } else {
        process.env[
          environmentName
        ] = originalValue;
      }
    }
  }
);

test(
  "extension policy rejects undeclared, unapproved, and unsupported capabilities before launch",
  async () => {
    await withExtension(
      `export function activate() {
        throw new Error("must not launch");
      }`,
      async extensionRoot => {
        const host =
          new ExtensionWorkerHost();

        await assert.rejects(
          host.run(
            createManifest({
              capabilities: [
                "host.environment.read",
              ],
            }),
            extensionRoot,
            "activate"
          ),
          hasCode(
            ErrorCodes
              .EXTENSION_PERMISSION_DENIED
          )
        );

        await assert.rejects(
          host.run(
            createManifest({
              capabilities: [
                "network.access",
              ],
            }),
            extensionRoot,
            "activate",
            {
              policy: {
                allowedCapabilities: [
                  "network.access",
                ],
              },
            }
          ),
          hasCode(
            ErrorCodes
              .EXTENSION_PERMISSION_DENIED
          )
        );

        await assert.rejects(
          host.run(
            createManifest({
              trust:
                "community",
            }),
            extensionRoot,
            "activate"
          ),
          hasCode(
            ErrorCodes
              .EXTENSION_PERMISSION_DENIED
          )
        );
      }
    );
  }
);

test(
  "extension workers deny direct filesystem, subprocess, and network access",
  async t => {
    const attempts = [
      {
        name: "filesystem imports",
        source:
          `import "node:fs/promises";
           export function activate() {}`,
        message: /import.*node:fs/u,
      },
      {
        name: "subprocess imports",
        source:
          `import "node:child_process";
           export function activate() {}`,
        message:
          /import.*node:child_process/u,
      },
      {
        name: "network fetch",
        source:
          `export async function activate() {
             await fetch("https://example.com");
           }`,
        message:
          /network access is not allowed/u,
      },
      {
        name:
          "direct built-in module access",
        source:
          `export function activate() {
             process.getBuiltinModule("node:fs");
           }`,
        message:
          /built-in module access is not allowed/u,
      },
      {
        name:
          "direct process signaling",
        source:
          `export function activate() {
             process.kill(process.pid, 0);
           }`,
        message:
          /privileged process access is not allowed/u,
      },
      {
        name: "direct IPC access",
        source:
          `export function activate() {
             process.send({
               type: "completed",
               value: "bypass",
             });
           }`,
        message:
          /Direct IPC access is not allowed/u,
      },
    ];

    for (const attempt of attempts) {
      await t.test(
        attempt.name,
        async () => {
          await withExtension(
            attempt.source,
            async extensionRoot => {
              await assert.rejects(
                new ExtensionWorkerHost()
                  .run(
                    createManifest(),
                    extensionRoot,
                    "activate"
                  ),
                error => {
                  assert.equal(
                    error.code,
                    ErrorCodes
                      .EXTENSION_EXECUTION_FAILED
                  );
                  assert.match(
                    error.message,
                    attempt.message
                  );
                  return true;
                }
              );
            }
          );
        }
      );
    }
  }
);

test(
  "extension imports cannot escape through a symbolic link or junction",
  async () => {
    const extensionRoot =
      await createExtension(
        `import "./escape/outside.js";
         export function activate() {}`
      );

    const outsideRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-extension-outside-"
        )
      );

    const linkPath =
      join(
        extensionRoot,
        "escape"
      );

    try {
      await writeFile(
        join(
          outsideRoot,
          "outside.js"
        ),
        "export const outside = true;\n",
        "utf8"
      );

      await symlink(
        outsideRoot,
        linkPath,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      await assert.rejects(
        new ExtensionWorkerHost()
          .run(
            createManifest(),
            extensionRoot,
            "activate"
          ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .EXTENSION_EXECUTION_FAILED
          );
          assert.match(
            error.message,
            /escapes its extension root|Access to this API has been restricted/u
          );
          return true;
        }
      );
    } finally {
      await rm(
        linkPath,
        {
          force: true,
        }
      );

      await rm(
        extensionRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        outsideRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "extension worker enforces time and output limits",
  async t => {
    await t.test(
      "time limit",
      async () => {
        await withExtension(
          `export async function activate() {
             setInterval(() => {}, 1000);
             await new Promise(() => {});
           }`,
          async extensionRoot => {
            await assert.rejects(
              new ExtensionWorkerHost()
                .run(
                  createManifest({
                    limits: {
                      timeoutMs: 100,
                      maxOldGenerationSizeMb: 32,
                      maxOutputBytes: 8192,
                    },
                  }),
                  extensionRoot,
                  "activate"
                ),
              hasCode(
                ErrorCodes
                  .EXTENSION_TIMEOUT
              )
            );
          }
        );
      }
    );

    await t.test(
      "output limit",
      async () => {
        await withExtension(
          `export function activate() {
             console.log("x".repeat(1024));
           }`,
          async extensionRoot => {
            await assert.rejects(
              new ExtensionWorkerHost()
                .run(
                  createManifest({
                    limits: {
                      timeoutMs: 2000,
                      maxOldGenerationSizeMb: 32,
                      maxOutputBytes: 256,
                    },
                  }),
                  extensionRoot,
                  "activate"
                ),
              hasCode(
                ErrorCodes
                  .EXTENSION_OUTPUT_LIMIT
              )
            );
          }
        );
      }
    );

    await t.test(
      "IPC return-value limit",
      async () => {
        await withExtension(
          `export function activate() {
             return "x".repeat(1024);
           }`,
          async extensionRoot => {
            await assert.rejects(
              new ExtensionWorkerHost()
                .run(
                  createManifest({
                    limits: {
                      timeoutMs: 2000,
                      maxOldGenerationSizeMb: 32,
                      maxOutputBytes: 256,
                    },
                  }),
                  extensionRoot,
                  "activate"
                ),
              hasCode(
                ErrorCodes
                  .EXTENSION_OUTPUT_LIMIT
              )
            );
          }
        );
      }
    );
  }
);

test(
  "extension worker enforces its per-extension concurrency limit",
  async () => {
    await withExtension(
      `export async function activate() {
         await new Promise(resolve => setTimeout(resolve, 250));
       }`,
      async extensionRoot => {
        const host =
          new ExtensionWorkerHost();
        const manifest =
          createManifest();

        const first = host.run(
          manifest,
          extensionRoot,
          "activate"
        );

        await new Promise(
          resolve =>
            setTimeout(resolve, 30)
        );

        await assert.rejects(
          host.run(
            manifest,
            extensionRoot,
            "activate"
          ),
          hasCode(
            ErrorCodes
              .EXTENSION_CONCURRENCY_LIMIT
          )
        );

        await first;
      }
    );
  }
);
