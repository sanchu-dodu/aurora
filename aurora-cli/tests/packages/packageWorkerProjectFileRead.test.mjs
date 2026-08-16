import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  readFile,
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
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  PackageWorker,
} from "../../dist/packages/installation/packageWorker.js";

import {
  PackageTrustPolicy,
} from "../../dist/packages/trust/packageTrustPolicy.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

function unsignedTrust() {
  return new PackageTrustPolicy({
    requireSignatures: false,
  });
}

function installerSource(lines) {
  return [
    "export async function install(context) {",
    ...lines.map(
      line => "  " + line
    ),
    "}",
    "",
  ].join("\n");
}

async function createProject(
  files = {}
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-worker-project-read-project-"
      )
    );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name:
          "package-worker-project-file-test",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: {},
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  for (
    const [relativePath, content]
    of Object.entries(files)
  ) {
    await writeFile(
      join(root, relativePath),
      content,
      "utf8"
    );
  }

  return root;
}

async function createPackageRoot() {
  return mkdtemp(
    join(
      tmpdir(),
      "aurora-worker-project-read-package-"
    )
  );
}

async function writePackage(
  packageRoot,
  id,
  source,
  {
    projectFileReads = [],
    capabilities = [
      "package.code.execute",
      "project.files.read",
    ],
  } = {}
) {
  const directory =
    join(packageRoot, id);

  await mkdir(
    directory,
    { recursive: true }
  );

  await writeFile(
    join(directory, "install.js"),
    source,
    "utf8"
  );

  await writePackageManifestV1(
    directory,
    {
      id,
      name: id,
      capabilities,
      projectFileReads,
    }
  );
}

function readPolicy(
  packageId,
  paths,
  allowedCapabilities = [
    "package.code.execute",
  ]
) {
  return {
    allowedCapabilities,
    packageProjectFileGrants: [
      {
        publisherId:
          "aurora-tests",
        packageId,
        paths,
      },
    ],
  };
}

test(
  "PackageWorker composes project-file reads from the exact InstallerContext project root",
  async () => {
    const id =
      "worker-project-read-context";

    const projectRoot =
      await createProject({
        "context-root.txt":
          "context-root-value\n",
      });

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "const value = await context.project.files.readText(\"context-root.txt\");",
        "if (value !== \"context-root-value\\n\") throw new Error(\"wrong-project-root\");",
      ]),
      {
        projectFileReads: [
          {
            path: "context-root.txt",
            required: true,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            ["context-root.txt"]
          ),
          unsignedTrust()
        );

      await worker.install(
        id,
        new InstallerContext(
          projectRoot
        )
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker permits package.json only when explicitly declared and granted",
  async () => {
    const id =
      "worker-project-read-package-json";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "const value = await context.project.files.readText(\"package.json\");",
        "if (!value.includes(\"package-worker-project-file-test\")) throw new Error(\"wrong-package-json\");",
      ]),
      {
        projectFileReads: [
          {
            path: "package.json",
            required: true,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            ["package.json"]
          ),
          unsignedTrust()
        );

      await worker.install(
        id,
        new InstallerContext(
          projectRoot
        )
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker manifest declarations cannot self-grant project-file authority",
  async () => {
    const id =
      "worker-project-read-no-self-grant";

    const projectRoot =
      await createProject({
        "declared.txt": "must-not-release\n",
      });

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "await context.project.files.readText(\"declared.txt\");",
      ]),
      {
        projectFileReads: [
          {
            path: "declared.txt",
            required: true,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          {
            allowedCapabilities: [
              "package.code.execute",
            ],
          },
          unsignedTrust()
        );

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
            /project\.files\.read/
          );

          return true;
        }
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker partial grants authorize only the exact declared project path",
  async () => {
    const id =
      "worker-project-read-partial";

    const projectRoot =
      await createProject({
        "allowed.txt": "allowed\n",
        "blocked.txt": "blocked\n",
      });

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "await context.project.files.readText(\"blocked.txt\");",
      ]),
      {
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
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            ["allowed.txt"]
          ),
          unsignedTrust()
        );

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
            /blocked\.txt/
          );

          return true;
        }
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker preserves optional missing project-file null semantics",
  async () => {
    const id =
      "worker-project-read-optional";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "const value = await context.project.files.readText(\"optional.txt\");",
        "if (value !== null) throw new Error(\"expected-null\");",
      ]),
      {
        projectFileReads: [
          {
            path: "optional.txt",
            required: false,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            ["optional.txt"]
          ),
          unsignedTrust()
        );

      await worker.install(
        id,
        new InstallerContext(
          projectRoot
        )
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker preserves required missing project-file failure semantics",
  async () => {
    const id =
      "worker-project-read-required";

    const projectRoot =
      await createProject();

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "await context.project.files.readText(\"required.txt\");",
      ]),
      {
        projectFileReads: [
          {
            path: "required.txt",
            required: true,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            ["required.txt"]
          ),
          unsignedTrust()
        );

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
            "PACKAGE_PROJECT_FILE_REQUIRED"
          );

          return true;
        }
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker project-file grant does not authorize another package sharing the worker",
  async () => {
    const rootId =
      "worker-project-read-root";

    const otherId =
      "worker-project-read-other";

    const projectRoot =
      await createProject({
        "root.txt": "root\n",
        "other.txt": "other\n",
      });

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      rootId,
      installerSource([
        "const value = await context.project.files.readText(\"root.txt\");",
        "if (value !== \"root\\n\") throw new Error(\"wrong-root-value\");",
      ]),
      {
        projectFileReads: [
          {
            path: "root.txt",
            required: true,
          },
        ],
      }
    );

    await writePackage(
      packageRoot,
      otherId,
      installerSource([
        "await context.project.files.readText(\"other.txt\");",
      ]),
      {
        projectFileReads: [
          {
            path: "other.txt",
            required: true,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            rootId,
            ["root.txt"]
          ),
          unsignedTrust()
        );

      const context =
        new InstallerContext(
          projectRoot
        );

      await worker.install(
        rootId,
        context
      );

      await assert.rejects(
        worker.install(
          otherId,
          context
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PERMISSION_DENIED"
          );

          return true;
        }
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker rebinds the project-file broker for every InstallerContext",
  async () => {
    const id =
      "worker-project-read-rebind";

    const projectOne =
      await createProject({
        "context.txt": "project-one\n",
      });

    const projectTwo =
      await createProject({
        "context.txt": "project-two\n",
      });

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "const value = await context.project.files.readText(\"context.txt\");",
        "await context.createFile(\"observed.txt\", value);",
      ]),
      {
        capabilities: [
          "package.code.execute",
          "project.files.read",
          "project.files.write",
        ],
        projectFileReads: [
          {
            path: "context.txt",
            required: true,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            ["context.txt"],
            [
              "package.code.execute",
              "project.files.write",
            ]
          ),
          unsignedTrust()
        );

      await worker.install(
        id,
        new InstallerContext(
          projectOne
        )
      );

      await worker.install(
        id,
        new InstallerContext(
          projectTwo
        )
      );

      assert.equal(
        await readFile(
          join(
            projectOne,
            "observed.txt"
          ),
          "utf8"
        ),
        "project-one\n"
      );

      assert.equal(
        await readFile(
          join(
            projectTwo,
            "observed.txt"
          ),
          "utf8"
        ),
        "project-two\n"
      );
    } finally {
      await rm(projectOne, {
        recursive: true,
        force: true,
      });

      await rm(projectTwo, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "PackageWorker rejects protected dotfile project-read declarations before package execution",
  async () => {
    const id =
      "worker-project-read-protected";

    const projectRoot =
      await createProject({
        ".env": "SECRET=must-not-release\n",
      });

    const packageRoot =
      await createPackageRoot();

    await writePackage(
      packageRoot,
      id,
      installerSource([
        "throw new Error(\"protected-package-executed\");",
      ]),
      {
        projectFileReads: [
          {
            path: ".env",
            required: false,
          },
        ],
      }
    );

    try {
      const worker =
        new PackageWorker(
          packageRoot,
          readPolicy(
            id,
            [".env"]
          ),
          unsignedTrust()
        );

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
            "INVALID_PACKAGE_MANIFEST"
          );

          assert.doesNotMatch(
            error.message,
            /protected-package-executed/
          );

          return true;
        }
      );
    } finally {
      await rm(projectRoot, {
        recursive: true,
        force: true,
      });

      await rm(packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
);
