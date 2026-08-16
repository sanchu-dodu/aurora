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
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

import {
  PACKAGE_PROJECT_FILE_MAX_BYTES,
} from "../../dist/packages/execution/packageProjectFileReadBroker.js";

import {
  PACKAGE_PROJECT_FILE_LIFECYCLE_MAX_BYTES,
  PackageExecutionHost,
} from "../../dist/packages/execution/packageExecutionHost.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

const PACKAGE_ID =
  "project-file-test-package";

const PUBLISHER_ID =
  "aurora-tests";

function projectManifest({
  projectFileReads = [
    {
      path: "config.txt",
      required: true,
    },
  ],
  capabilities = [
    "package.code.execute",
    "project.files.read",
  ],
} = {}) {
  return {
    id: PACKAGE_ID,
    publisher: {
      id: PUBLISHER_ID,
    },
    capabilities,
    projectFileReads,
  };
}

function executionPolicy(
  manifest,
  grantPaths =
    (manifest.projectFileReads ?? [])
      .map(file => file.path)
) {
  return new PackageCapabilityPolicy({
    packageProjectFileGrants: [
      {
        publisherId:
          manifest.publisher.id,
        packageId:
          manifest.id,
        paths: grantPaths,
      },
    ],
  });
}

function moduleSource(body) {
  return [
    "export async function install(context) {",
    body,
    "}",
    "",
  ].join("\n");
}

async function withHarness(
  {
    manifest = projectManifest(),
    reader,
    grantPaths,
    source,
  },
  callback
) {
  const sandbox =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-project-file-execution-"
      )
    );

  const projectRoot =
    join(sandbox, "project");

  const packageRoot =
    join(sandbox, "packages");

  const packageDirectory =
    join(
      packageRoot,
      manifest.id
    );

  await mkdir(
    projectRoot,
    { recursive: true }
  );

  await mkdir(
    packageDirectory,
    { recursive: true }
  );

  await writeFile(
    join(
      packageDirectory,
      "installer.mjs"
    ),
    source,
    "utf8"
  );

  const host =
    new PackageExecutionHost(
      executionPolicy(
        manifest,
        grantPaths
      ),
      undefined,
      undefined,
      reader
    );

  const context =
    new InstallerContext(
      projectRoot
    );

  const run =
    () =>
      host.run(
        manifest,
        packageRoot,
        "installer.mjs",
        "install",
        context
      );

  try {
    await callback({
      run,
      host,
      context,
      projectRoot,
      packageRoot,
    });
  } finally {
    await rm(
      sandbox,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

function countingReader(
  value
) {
  const state = {
    calls: 0,
  };

  return {
    state,
    reader: {
      async readProjectFileText() {
        state.calls += 1;
        return typeof value === "function"
          ? value(state.calls)
          : value;
      },
    },
  };
}

test(
  "controlled project-file IPC exposes only the trusted reader value",
  async () => {
    const controlled =
      countingReader("trusted-project-value");

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          [
            '  const value = await context.project.files.readText("config.txt");',
            '  if (value !== "trusted-project-value") throw new Error("unexpected project value");',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await run();
        assert.equal(
          controlled.state.calls,
          1
        );
      }
    );
  }
);

test(
  "optional null crosses project-file IPC as null",
  async () => {
    const manifest =
      projectManifest({
        projectFileReads: [
          {
            path: "optional.txt",
            required: false,
          },
        ],
      });

    const controlled =
      countingReader(null);

    await withHarness(
      {
        manifest,
        reader: controlled.reader,
        source: moduleSource(
          [
            '  const value = await context.project.files.readText("optional.txt");',
            '  if (value !== null) throw new Error("expected null");',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await run();
        assert.equal(
          controlled.state.calls,
          1
        );
      }
    );
  }
);

test(
  "required null fails at the authoritative host boundary",
  async () => {
    const controlled =
      countingReader(null);

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          '  await context.project.files.readText("config.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_PROJECT_FILE_REQUIRED
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "missing trusted project-file reader fails closed",
  async () => {
    await withHarness(
      {
        reader: undefined,
        source: moduleSource(
          '  await context.project.files.readText("config.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "undeclared project path fails before reader invocation",
  async () => {
    const controlled =
      countingReader("should-not-release");

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          '  await context.project.files.readText("other.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED
            );
            return true;
          }
        );

        assert.equal(
          controlled.state.calls,
          0
        );
      }
    );
  }
);

test(
  "ungranted project path fails before reader invocation",
  async () => {
    const manifest =
      projectManifest({
        projectFileReads: [
          {
            path: "allowed.txt",
            required: true,
          },
          {
            path: "blocked.txt",
            required: true,
          },
        ],
      });

    const controlled =
      countingReader("should-not-release");

    await withHarness(
      {
        manifest,
        reader: controlled.reader,
        grantPaths: ["allowed.txt"],
        source: moduleSource(
          '  await context.project.files.readText("blocked.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED
            );
            return true;
          }
        );

        assert.equal(
          controlled.state.calls,
          0
        );
      }
    );
  }
);

test(
  "protected read-sensitive path fails before custom reader invocation",
  async () => {
    const manifest =
      projectManifest({
        projectFileReads: [
          {
            path: ".env",
            required: false,
          },
        ],
      });

    const controlled =
      countingReader("should-not-release");

    await withHarness(
      {
        manifest,
        reader: controlled.reader,
        grantPaths: [".env"],
        source: moduleSource(
          '  await context.project.files.readText(".env");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED
            );
            return true;
          }
        );

        assert.equal(
          controlled.state.calls,
          0
        );
      }
    );
  }
);

test(
  "malformed project-file request input fails before reader invocation",
  async () => {
    const controlled =
      countingReader("should-not-release");

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          '  await context.project.files.readText({ path: "config.txt" });'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED
            );
            return true;
          }
        );

        assert.equal(
          controlled.state.calls,
          0
        );
      }
    );
  }
);

test(
  "non-string custom project-file reader value fails closed",
  async () => {
    const controlled =
      countingReader({ invalid: true });

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          '  await context.project.files.readText("config.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "NUL-containing custom project-file reader value fails closed",
  async () => {
    const controlled =
      countingReader("before\0after");

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          '  await context.project.files.readText("config.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "custom project-file reader value above 256 KiB fails with PACKAGE_READ_LIMIT",
  async () => {
    const controlled =
      countingReader(
        "a".repeat(
          PACKAGE_PROJECT_FILE_MAX_BYTES + 1
        )
      );

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          '  await context.project.files.readText("config.txt");'
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_READ_LIMIT
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "exactly four 256 KiB releases consume exactly the 1 MiB lifecycle budget",
  async () => {
    assert.equal(
      PACKAGE_PROJECT_FILE_LIFECYCLE_MAX_BYTES,
      4 * PACKAGE_PROJECT_FILE_MAX_BYTES
    );

    const controlled =
      countingReader(
        "a".repeat(
          PACKAGE_PROJECT_FILE_MAX_BYTES
        )
      );

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          [
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await run();
        assert.equal(
          controlled.state.calls,
          4
        );
      }
    );
  }
);

test(
  "a fifth non-empty release exceeds the independent 1 MiB project-file lifecycle budget",
  async () => {
    const controlled =
      countingReader(
        call =>
          call <= 4
            ? "a".repeat(
                PACKAGE_PROJECT_FILE_MAX_BYTES
              )
            : "x"
      );

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          [
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_READ_LIMIT
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "repeated reads of the same project file count repeatedly",
  async () => {
    const chunk =
      "r".repeat(
        256 * 1024
      );

    const controlled =
      countingReader(chunk);

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          [
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await assert.rejects(
          run(),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_READ_LIMIT
            );
            return true;
          }
        );

        assert.equal(
          controlled.state.calls,
          5
        );
      }
    );
  }
);

test(
  "a new lifecycle execution receives a fresh project-file read budget",
  async () => {
    const controlled =
      countingReader(
        "a".repeat(
          PACKAGE_PROJECT_FILE_MAX_BYTES
        )
      );

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          [
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
            '  await context.project.files.readText("config.txt");',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await run();
        await run();

        assert.equal(
          controlled.state.calls,
          8
        );
      }
    );
  }
);

test(
  "optional null and empty project files consume zero lifecycle bytes",
  async () => {
    const manifest =
      projectManifest({
        projectFileReads: [
          {
            path: "optional.txt",
            required: false,
          },
          {
            path: "empty.txt",
            required: true,
          },
        ],
      });

    const state = {
      calls: 0,
    };

    const reader = {
      async readProjectFileText(
        _manifest,
        relativePath
      ) {
        state.calls += 1;
        return relativePath === "optional.txt"
          ? null
          : "";
      },
    };

    await withHarness(
      {
        manifest,
        reader,
        source: moduleSource(
          [
            '  for (let i = 0; i < 16; i += 1) {',
            '    await context.project.files.readText("optional.txt");',
            '    await context.project.files.readText("empty.txt");',
            '  }',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        await run();
        assert.equal(state.calls, 32);
      }
    );
  }
);

test(
  "project-file values are not automatically added to the secret-redaction set",
  async () => {
    const marker =
      "PROJECT_FILE_VISIBLE_MARKER";

    const controlled =
      countingReader(marker);

    await withHarness(
      {
        reader: controlled.reader,
        source: moduleSource(
          [
            '  const value = await context.project.files.readText("config.txt");',
            '  console.log(value);',
          ].join("\n")
        ),
      },
      async ({ run }) => {
        const result =
          await run();

        assert.match(
          result.stdout,
          /PROJECT_FILE_VISIBLE_MARKER/
        );
      }
    );
  }
);
