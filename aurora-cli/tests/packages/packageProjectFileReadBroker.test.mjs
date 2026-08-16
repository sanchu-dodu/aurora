import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdir,
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
  PackageCapabilityPolicy,
} from "../../dist/packages/execution/packageCapabilityPolicy.js";

import {
  PACKAGE_PROJECT_FILE_MAX_BYTES,
  PackageProjectFileReadBroker,
} from "../../dist/packages/execution/packageProjectFileReadBroker.js";

function projectManifest(
  path,
  {
    required = true,
    capabilities = [
      "project.files.read",
    ],
    id = "test-package",
    publisherId = "aurora-tests",
    projectFileReads,
  } = {}
) {
  return {
    id,
    publisher: {
      id: publisherId,
    },
    capabilities,
    projectFileReads:
      projectFileReads ?? [
        {
          path,
          required,
        },
      ],
  };
}

function createBroker(
  projectRoot,
  manifest,
  grantPaths =
    (manifest.projectFileReads ?? [])
      .map(file => file.path)
) {
  return new PackageProjectFileReadBroker({
    projectRoot,
    accessPolicy:
      new PackageCapabilityPolicy({
        packageProjectFileGrants: [
          {
            publisherId:
              manifest.publisher.id,
            packageId:
              manifest.id,
            paths: grantPaths,
          },
        ],
      }),
  });
}

async function withProject(
  prefix,
  callback
) {
  const sandbox =
    await mkdtemp(
      join(tmpdir(), prefix)
    );

  const projectRoot =
    join(sandbox, "project");

  await mkdir(projectRoot);

  try {
    await callback({
      sandbox,
      projectRoot,
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

test(
  "declared ordinary project text file reads successfully",
  async () => {
    await withProject(
      "aurora-project-read-basic-",
      async ({ projectRoot }) => {
        await mkdir(
          join(projectRoot, "config")
        );

        await writeFile(
          join(
            projectRoot,
            "config",
            "app.txt"
          ),
          "aurora\n",
          "utf8"
        );

        const manifest =
          projectManifest(
            "config/app.txt"
          );

        const value =
          await createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "config/app.txt"
          );

        assert.equal(
          value,
          "aurora\n"
        );
      }
    );
  }
);

test(
  "package.json is readable when exactly declared and granted",
  async () => {
    await withProject(
      "aurora-project-read-package-json-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "package.json"),
          "{\"name\":\"demo\"}\n",
          "utf8"
        );

        const manifest =
          projectManifest("package.json");

        const value =
          await createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "package.json"
          );

        assert.equal(
          value,
          "{\"name\":\"demo\"}\n"
        );
      }
    );
  }
);

test(
  "empty project file returns an empty string",
  async () => {
    await withProject(
      "aurora-project-read-empty-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "empty.txt"),
          Buffer.alloc(0)
        );

        const manifest =
          projectManifest("empty.txt");

        assert.equal(
          await createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "empty.txt"
          ),
          ""
        );
      }
    );
  }
);

test(
  "optional missing project file returns null",
  async () => {
    await withProject(
      "aurora-project-read-optional-",
      async ({ projectRoot }) => {
        const manifest =
          projectManifest(
            "optional.txt",
            { required: false }
          );

        assert.equal(
          await createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "optional.txt"
          ),
          null
        );
      }
    );
  }
);

test(
  "required missing project file fails distinctly",
  async () => {
    await withProject(
      "aurora-project-read-required-",
      async ({ projectRoot }) => {
        const manifest =
          projectManifest("required.txt");

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "required.txt"
          ),
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
  "undeclared path fails before path-boundary resolution",
  async () => {
    await withProject(
      "aurora-project-read-undeclared-",
      async ({ projectRoot }) => {
        const manifest =
          projectManifest("package.json");

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "../outside.txt"
          ),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED
            );
            assert.match(
              error.message,
              /not declared/
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "missing project.files.read capability fails before target access",
  async () => {
    await withProject(
      "aurora-project-read-capability-",
      async ({ projectRoot }) => {
        const manifest =
          projectManifest(
            "package.json",
            { capabilities: [] }
          );

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "package.json"
          ),
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
  "read-sensitive paths remain denied by the host broker",
  async () => {
    await withProject(
      "aurora-project-read-protected-",
      async ({ projectRoot }) => {
        const paths = [
          ".git/config",
          ".AURORA/state.json",
          ".env",
          ".ENV.LOCAL",
          ".npmrc",
          "config/.YARNRC",
          ".yarnrc.yml",
          ".netrc",
          "_netrc",
          ".pypirc",
        ];

        const manifest =
          projectManifest(
            paths[0],
            {
              projectFileReads:
                paths.map(path => ({
                  path,
                  required: false,
                })),
            }
          );

        const broker =
          createBroker(
            projectRoot,
            manifest,
            paths
          );

        for (const path of paths) {
          await assert.rejects(
            broker.readProjectFileText(
              manifest,
              path
            ),
            error => {
              assert.equal(
                error.code,
                ErrorCodes
                  .PACKAGE_PERMISSION_DENIED,
                path
              );
              return true;
            }
          );
        }
      }
    );
  }
);

test(
  "symbolic-link or junction escape is rejected",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-project-read-link-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const outsideRoot =
      join(sandbox, "outside");

    const linkPath =
      join(projectRoot, "linked");

    await mkdir(projectRoot);
    await mkdir(outsideRoot);

    await writeFile(
      join(outsideRoot, "secret.txt"),
      "outside\n",
      "utf8"
    );

    try {
      await symlink(
        outsideRoot,
        linkPath,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      const manifest =
        projectManifest(
          "linked/secret.txt"
        );

      await assert.rejects(
        createBroker(
          projectRoot,
          manifest
        ).readProjectFileText(
          manifest,
          "linked/secret.txt"
        ),
        error => {
          assert.equal(
            error.code,
            ErrorCodes
              .UNSAFE_PROJECT_PATH
          );
          return true;
        }
      );
    } finally {
      await rm(
        linkPath,
        { force: true }
      );

      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "directory target is rejected as non-regular",
  async () => {
    await withProject(
      "aurora-project-read-directory-",
      async ({ projectRoot }) => {
        await mkdir(
          join(projectRoot, "config")
        );

        const manifest =
          projectManifest("config");

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "config"
          ),
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
  "exact 256 KiB project file is accepted",
  async () => {
    await withProject(
      "aurora-project-read-limit-exact-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "exact.txt"),
          Buffer.alloc(
            PACKAGE_PROJECT_FILE_MAX_BYTES,
            0x61
          )
        );

        const manifest =
          projectManifest("exact.txt");

        const value =
          await createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "exact.txt"
          );

        assert.equal(
          Buffer.byteLength(
            value,
            "utf8"
          ),
          PACKAGE_PROJECT_FILE_MAX_BYTES
        );
      }
    );
  }
);

test(
  "project file above 256 KiB fails with PACKAGE_READ_LIMIT",
  async () => {
    await withProject(
      "aurora-project-read-limit-over-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "large.txt"),
          Buffer.alloc(
            PACKAGE_PROJECT_FILE_MAX_BYTES + 1,
            0x61
          )
        );

        const manifest =
          projectManifest("large.txt");

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "large.txt"
          ),
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
  "invalid UTF-8 project file fails closed",
  async () => {
    await withProject(
      "aurora-project-read-utf8-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "invalid.txt"),
          Buffer.from([
            0xc3,
            0x28,
          ])
        );

        const manifest =
          projectManifest("invalid.txt");

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "invalid.txt"
          ),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED
            );
            assert.match(
              error.message,
              /valid UTF-8/
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "NUL-containing project text fails closed",
  async () => {
    await withProject(
      "aurora-project-read-nul-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "contains-nul.txt"),
          "before\0after",
          "utf8"
        );

        const manifest =
          projectManifest("contains-nul.txt");

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "contains-nul.txt"
          ),
          error => {
            assert.equal(
              error.code,
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED
            );
            assert.match(
              error.message,
              /NUL/
            );
            return true;
          }
        );
      }
    );
  }
);

test(
  "optional path with unexpected filesystem failure is not converted to null",
  async () => {
    await withProject(
      "aurora-project-read-fs-error-",
      async ({ projectRoot }) => {
        await writeFile(
          join(projectRoot, "container"),
          "not-a-directory\n",
          "utf8"
        );

        const manifest =
          projectManifest(
            "container/child.txt",
            { required: false }
          );

        await assert.rejects(
          createBroker(
            projectRoot,
            manifest
          ).readProjectFileText(
            manifest,
            "container/child.txt"
          ),
          error => {
            assert.notEqual(
              error,
              null
            );

            assert.equal(
              error.code,
              ErrorCodes
                .UNSAFE_PROJECT_PATH
            );

            return true;
          }
        );
      }
    );
  }
);
