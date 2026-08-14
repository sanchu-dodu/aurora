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
  CompatibilityChecker,
} from "../../dist/packages/compatibility/compatibilityChecker.js";

import {
  resolveDependencies,
} from "../../dist/packages/dependencyResolver.js";

import {
  PackageArtifactVerifier,
} from "../../dist/packages/integrity/packageArtifactVerifier.js";

import {
  loadInstaller,
} from "../../dist/packages/installer/installerLoader.js";

import {
  PackageInstaller,
} from "../../dist/packages/installer/packageInstaller.js";

import {
  getDefaultPackageRoot,
} from "../../dist/packages/packagePaths.js";

import {
  validatePackage,
} from "../../dist/packages/packageValidator.js";

import {
  OfficialRepository,
} from "../../dist/packages/repositories/officialRepository.js";

import {
  PackageTrustPolicy,
} from "../../dist/packages/trust/packageTrustPolicy.js";

import {
  isManifestVersionRange,
  satisfiesManifestVersionRange,
} from "../../dist/packages/version/manifestVersion.js";

import {
  createManifestV1,
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

function createUnsignedCompatibilityPolicy() {
  return new PackageTrustPolicy({
    requireSignatures:
      false,
  });
}

function createUnsignedCompatibilityInstaller(
  options
) {
  return new PackageInstaller({
    ...options,

    trust: {
      requireSignatures:
        false,
    },
  });
}

async function resolveUnsignedDependencies(
  packageId,
  packageRoot,
  resolved =
    new Set()
) {
  return resolveDependencies(
    packageId,
    packageRoot,
    resolved,
    createUnsignedCompatibilityPolicy()
  );
}

function assertAuroraError(
  expectedCode,
  expectedMessage
) {
  return (error) => {
    assert.equal(
      error.code,
      expectedCode
    );

    if (expectedMessage) {
      assert.match(
        error.message,
        expectedMessage
      );
    }

    return true;
  };
}

test(
  "built-in packages use valid, verified Manifest v1 artifacts",
  async () => {
    const packageRoot =
      getDefaultPackageRoot();

    const repository =
      new OfficialRepository(
        packageRoot
      );

    const verifier =
      new PackageArtifactVerifier();

    const manifests =
      await repository.getAllPackages();

    assert.deepEqual(
      manifests.map(
        (manifest) => manifest.id
      ),
      [
        "auth",
        "database",
        "env",
      ]
    );

    for (const manifest of manifests) {
      assert.equal(
        manifest.manifestVersion,
        1
      );

      await verifier.verify(
        packageRoot,
        manifest
      );
    }
  }
);

test(
  "Manifest v1 rejects ambiguous, unsafe, and undeclared input",
  () => {
    const digest = "0".repeat(64);

    const invalidManifests = [
      [
        "unknown field",
        createManifestV1({
          unexpected: true,
        }),
        /unexpected/i,
      ],
      [
        "unsafe identifier",
        createManifestV1({
          id: "../escape",
        }),
        /id:/i,
      ],
      [
        "non-canonical version",
        createManifestV1({
          version: "1.0",
        }),
        /version:/i,
      ],
      [
        "non-HTTPS publisher",
        createManifestV1({
          publisher: {
            id: "publisher",
            name: "Publisher",
            url: "http://example.com",
          },
        }),
        /publisher\.url/i,
      ],
      [
        "duplicate tags",
        createManifestV1({
          tags: [
            "test",
            "test",
          ],
        }),
        /duplicate/i,
      ],
      [
        "undeclared execution capability",
        createManifestV1({
          files: [
            {
              path: "install.js",
              role: "installer",
              digest,
            },
          ],
        }),
        /package\.code\.execute/i,
      ],
      [
        "unsafe artifact path",
        createManifestV1({
          files: [
            {
              path: "../install.js",
              role: "installer",
              digest,
            },
          ],
          capabilities: [
            "package.code.execute",
          ],
        }),
        /files\.0\.path/i,
      ],
      [
        "dependency and conflict overlap",
        createManifestV1({
          dependencies: [
            {
              id: "database",
              version: "^1.0.0",
              optional: false,
            },
          ],
          conflicts: [
            {
              id: "database",
              version: "^1.0.0",
            },
          ],
        }),
        /both a dependency and a conflict/i,
      ],
      [
        "revocation without a reason",
        createManifestV1({
          lifecycle: {
            deprecated: false,
            revoked: true,
          },
        }),
        /require a reason/i,
      ],
    ];

    for (
      const [
        label,
        manifest,
        expectedMessage,
      ] of invalidManifests
    ) {
      assert.throws(
        () =>
          validatePackage(
            manifest,
            label
          ),
        assertAuroraError(
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
          expectedMessage
        ),
        label
      );
    }
  }
);

test(
  "Manifest v1 version ranges are deterministic and prerelease-safe",
  () => {
    assert.equal(
      satisfiesManifestVersionRange(
        "1.4.9",
        "^1.2.0"
      ),
      true
    );

    assert.equal(
      satisfiesManifestVersionRange(
        "2.0.0",
        "^1.2.0"
      ),
      false
    );

    assert.equal(
      satisfiesManifestVersionRange(
        "0.2.9",
        "^0.2.3"
      ),
      true
    );

    assert.equal(
      satisfiesManifestVersionRange(
        "0.3.0",
        "^0.2.3"
      ),
      false
    );

    assert.equal(
      satisfiesManifestVersionRange(
        "1.3.0-beta.1",
        ">=1.2.0 <2.0.0"
      ),
      false
    );

    assert.equal(
      satisfiesManifestVersionRange(
        "1.3.0-beta.1",
        ">=1.3.0-beta.1 <2.0.0"
      ),
      true
    );

    assert.equal(
      isManifestVersionRange(
        ">=1.0.0  <2.0.0"
      ),
      false
    );

    assert.equal(
      satisfiesManifestVersionRange(
        "1.0.0-9007199254740993",
        ">1.0.0-9007199254740992"
      ),
      true
    );
  }
);

test(
  "artifact verification detects modified and undeclared files",
  async () => {
    const packageRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-manifest-artifact-"
        )
      );

    const packageDirectory =
      join(packageRoot, "verified");

    try {
      await mkdir(
        packageDirectory,
        {
          recursive: true,
        }
      );

      await writeFile(
        join(
          packageDirectory,
          "asset.txt"
        ),
        "trusted\n",
        "utf8"
      );

      const manifest =
        validatePackage(
          await writePackageManifestV1(
            packageDirectory,
            {
              id: "verified",
            }
          )
        );

      const verifier =
        new PackageArtifactVerifier();

      await verifier.verify(
        packageRoot,
        manifest
      );

      await writeFile(
        join(
          packageDirectory,
          "asset.txt"
        ),
        "modified\n",
        "utf8"
      );

      await assert.rejects(
        verifier.verify(
          packageRoot,
          manifest
        ),
        assertAuroraError(
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED,
          /digest mismatch/i
        )
      );

      await writeFile(
        join(
          packageDirectory,
          "asset.txt"
        ),
        "trusted\n",
        "utf8"
      );

      await writeFile(
        join(
          packageDirectory,
          "undeclared.txt"
        ),
        "not declared\n",
        "utf8"
      );

      await assert.rejects(
        verifier.verify(
          packageRoot,
          manifest
        ),
        assertAuroraError(
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED,
          /do not match artifact files/i
        )
      );
    } finally {
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
  "compatibility checks reject incompatible and revoked packages",
  () => {
    const checker =
      new CompatibilityChecker({
        auroraVersion: "0.1.0",
        nodeVersion: "22.0.0",
        platform: "linux",
        architecture: "x64",
      });

    const incompatible =
      validatePackage(
        createManifestV1({
          compatibility: {
            aurora: ">=1.0.0",
            node: ">=22.0.0",
          },
        })
      );

    assert.throws(
      () => checker.check(incompatible),
      assertAuroraError(
        ErrorCodes.PACKAGE_INCOMPATIBLE,
        /Aurora 0\.1\.0/i
      )
    );

    const revoked =
      validatePackage(
        createManifestV1({
          lifecycle: {
            deprecated: false,
            revoked: true,
            reason: "Security incident.",
          },
        })
      );

    assert.throws(
      () => checker.check(revoked),
      assertAuroraError(
        ErrorCodes.PACKAGE_REVOKED,
        /Security incident/i
      )
    );
  }
);

test(
  "repository identity and declared installer paths fail closed",
  async () => {
    const packageRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-manifest-loader-"
        )
      );

    try {
      const packageDirectory =
        join(packageRoot, "custom");

      await mkdir(
        join(
          packageDirectory,
          "runtime"
        ),
        {
          recursive: true,
        }
      );

      await writeFile(
        join(
          packageDirectory,
          "runtime",
          "custom-installer.js"
        ),
        "export async function install() {}\n",
        "utf8"
      );

      const manifest =
        validatePackage(
          await writePackageManifestV1(
            packageDirectory,
            {
              id: "custom",
              fileRoles: {
                "runtime/custom-installer.js":
                  "installer",
              },
            }
          )
        );

      const installer =
        await loadInstaller(
          manifest,
          packageRoot
        );

      assert.equal(
        typeof installer,
        "function"
      );

      const repository =
        new OfficialRepository(
          packageRoot
        );

      assert.equal(
        (
          await repository
            .loadManifest("custom")
        ).id,
        "custom"
      );

      await writePackageManifestV1(
        packageDirectory,
        {
          id: "different-id",
          fileRoles: {
            "runtime/custom-installer.js":
              "installer",
          },
        }
      );

      await assert.rejects(
        repository.loadManifest(
          "custom"
        ),
        assertAuroraError(
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
          /contains manifest id 'different-id'/i
        )
      );

      await assert.rejects(
        repository.hasPackage(
          "../escape"
        ),
        assertAuroraError(
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
          /invalid package identifier/i
        )
      );
    } finally {
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
  "dependencies, optional packages, and conflicts enforce manifest ranges",
  async () => {
    const packageRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-manifest-dependencies-"
        )
      );

    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-manifest-project-"
        )
      );

    try {
      const optionalRoot =
        join(
          packageRoot,
          "optional-root"
        );

      await mkdir(
        optionalRoot,
        {
          recursive: true,
        }
      );

      await writePackageManifestV1(
        optionalRoot,
        {
          id: "optional-root",
          dependencies: [
            {
              id: "not-present",
              version: "^1.0.0",
              optional: true,
            },
          ],
        }
      );

      assert.deepEqual(
        await resolveUnsignedDependencies(
          "optional-root",
          packageRoot
        ),
        [
          "optional-root",
        ]
      );

      const dependencyRoot =
        join(
          packageRoot,
          "dependency"
        );

      const requiredRoot =
        join(
          packageRoot,
          "required-root"
        );

      await mkdir(
        dependencyRoot,
        {
          recursive: true,
        }
      );

      await mkdir(
        requiredRoot,
        {
          recursive: true,
        }
      );

      await writePackageManifestV1(
        dependencyRoot,
        {
          id: "dependency",
          version: "1.0.0",
        }
      );

      await writePackageManifestV1(
        requiredRoot,
        {
          id: "required-root",
          dependencies: [
            {
              id: "dependency",
              version: "^2.0.0",
              optional: false,
            },
          ],
        }
      );

      await assert.rejects(
        resolveUnsignedDependencies(
          "required-root",
          packageRoot
        ),
        assertAuroraError(
          ErrorCodes
            .PACKAGE_INCOMPATIBLE,
          /requires 'dependency' \^2\.0\.0/i
        )
      );

      const conflictRoot =
        join(
          packageRoot,
          "conflict-root"
        );

      await mkdir(
        conflictRoot,
        {
          recursive: true,
        }
      );

      await writePackageManifestV1(
        conflictRoot,
        {
          id: "conflict-root",
          conflicts: [
            {
              id: "installed-package",
              version: "^1.0.0",
              reason:
                "The packages cannot be combined.",
            },
          ],
        }
      );

      await mkdir(
        join(
          projectRoot,
          ".aurora"
        ),
        {
          recursive: true,
        }
      );

      await writeFile(
        join(
          projectRoot,
          ".aurora",
          "cache.json"
        ),
        `${JSON.stringify({
          "installed-package": {
            version: "1.2.0",
            installedAt:
              "2026-01-01T00:00:00.000Z",
          },
        })}\n`,
        "utf8"
      );

      await assert.rejects(
        createUnsignedCompatibilityInstaller({
          packageRoot,
          projectRoot,
        }).install("conflict-root"),
        assertAuroraError(
          ErrorCodes
            .PACKAGE_INCOMPATIBLE,
          /conflicts with 'installed-package' 1\.2\.0/i
        )
      );
    } finally {
      await rm(
        packageRoot,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
