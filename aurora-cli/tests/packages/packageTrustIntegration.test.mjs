import assert from "node:assert/strict";

import {
  generateKeyPairSync,
  sign,
} from "node:crypto";

import {
  access,
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

import test from "node:test";

import {
  CacheManager,
} from "../../dist/packages/cache/cacheManager.js";

import {
  PackageWorker,
} from "../../dist/packages/installation/packageWorker.js";

import {
  PackageInstaller,
} from "../../dist/packages/installer/packageInstaller.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  loadManifest,
} from "../../dist/packages/manifestLoader.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  PackageTrustPolicy,
} from "../../dist/packages/trust/packageTrustPolicy.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

async function exists(
  filePath
) {
  try {
    await access(
      filePath
    );

    return true;
  }
  catch {
    return false;
  }
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

function createTrustOptions(
  authority,
  overrides = {}
) {
  return {
    requireSignatures:
      true,

    trustedPublishers: [
      {
        id:
          "aurora-tests",
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
    ],

    ...overrides,
  };
}

function createTrustPolicy(
  authority,
  overrides = {}
) {
  return new PackageTrustPolicy(
    createTrustOptions(
      authority,
      overrides
    )
  );
}

async function createProject() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-trust-project-"
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
          "aurora-package-trust-test",
        version:
          "1.0.0",
        private:
          true,
        type:
          "module",
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
  overrides = {}
) {
  const packageRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-package-trust-artifact-"
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
      recursive:
        true,
    }
  );

  const installerPath =
    join(
      packageDirectory,
      "install.js"
    );

  await writeFile(
    installerPath,
    source,
    "utf8"
  );

  await writePackageManifestV1(
    packageDirectory,
    {
      id,
      name:
        id,
      capabilities: [
        "package.code.execute",
        "project.files.write",
      ],
      ...overrides,
    }
  );

  return {
    packageRoot,
    packageDirectory,
    installerPath,
    manifestPath:
      join(
        packageDirectory,
        "manifest.json"
      ),
  };
}

async function signPackage(
  packageArtifact,
  authority
) {
  const manifest =
    JSON.parse(
      await readFile(
        packageArtifact
          .manifestPath,
        "utf8"
      )
    );

  const envelope = {
    version: 1,
    algorithm:
      "ed25519",
    keyId:
      authority.keyId,
    value:
      "",
  };

  const candidate = {
    ...manifest,
    signature:
      envelope,
  };

  const value =
    sign(
      null,
      createPackageSigningPayload(
        candidate
      ),
      authority.privateKey
    ).toString(
      "base64url"
    );

  const signed = {
    ...candidate,
    signature: {
      ...envelope,
      value,
    },
  };

  await writeFile(
    packageArtifact
      .manifestPath,
    JSON.stringify(
      signed,
      null,
      2
    ) + "\n",
    "utf8"
  );

  return signed;
}

async function cleanup(
  ...roots
) {
  await Promise.all(
    roots.map(
      root =>
        rm(
          root,
          {
            recursive:
              true,
            force:
              true,
          }
        )
    )
  );
}

test(
  "authoritative manifest loader rejects duplicate decoded JSON properties before schema validation",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-strict-loader-"
        )
      );

    const manifestPath =
      join(
        root,
        "manifest.json"
      );

    await writeFile(
      manifestPath,
      `{
        "id": "first",
        "\\u0069d": "second"
      }`,
      "utf8"
    );

    try {
      await assert.rejects(
        loadManifest(
          manifestPath
        ),
        error => {
          assert.equal(
            error.code,
            "INVALID_PACKAGE_MANIFEST"
          );

          assert.match(
            error.message,
            /invalid or ambiguous JSON/
          );

          assert.match(
            String(
              error.cause?.message ??
              ""
            ),
            /duplicate object property 'id'/
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(root);
    }
  }
);

test(
  "secure default rejects unsigned manifests while explicit compatibility can permit them",
  async () => {
    const packageArtifact =
      await createPackage(
        "unsigned-transition",
        `
export async function install() {
}
`
      );

    try {
      const manifest =
        await loadManifest(
          packageArtifact
            .manifestPath
        );

      const compatibility =
        new PackageTrustPolicy({
          requireSignatures:
            false,
        });

      assert.equal(
        compatibility.verify(
          manifest
        ),
        undefined
      );

      const required =
        new PackageTrustPolicy();

      assert.throws(
        () =>
          required.verify(
            manifest
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNATURE_REQUIRED"
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "a present package signature is never ignored even when unsigned compatibility is explicit",
  async () => {
    const authority =
      createAuthority();

    const packageArtifact =
      await createPackage(
        "signed-untrusted",
        `
export async function install() {
}
`
      );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      const manifest =
        await loadManifest(
          packageArtifact
            .manifestPath
        );

      /*
       * Unsigned compatibility is deliberately enabled.
       *
       * The package is nevertheless signed, so Aurora
       * must authenticate it rather than silently
       * treating it as an unsigned legacy package.
       */
      const policy =
        new PackageTrustPolicy({
          requireSignatures:
            false,
        });

      assert.throws(
        () =>
          policy.verify(
            manifest
          ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PUBLISHER_UNTRUSTED"
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "PackageWorker directly executes a valid trusted signed package",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "trusted-worker",
        `
export async function install(context) {
  await context.createFile(
    "src/trusted-worker.txt",
    "trusted execution"
  );
}
`
      );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      const worker =
        new PackageWorker(
          packageArtifact
            .packageRoot,
          {},
          createTrustPolicy(
            authority
          )
        );

      await worker.install(
        "trusted-worker",
        new InstallerContext(
          projectRoot
        )
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "src",
            "trusted-worker.txt"
          ),
          "utf8"
        ),
        "trusted execution"
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "PackageWorker cannot execute an unsigned package when trust requires signatures",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "unsigned-worker",
        `
export async function install(context) {
  await context.createFile(
    "src/unsigned-executed.txt",
    "must never exist"
  );
}
`
      );

    try {
      const worker =
        new PackageWorker(
          packageArtifact
            .packageRoot,
          {},
          createTrustPolicy(
            authority
          )
        );

      await assert.rejects(
        worker.install(
          "unsigned-worker",
          new InstallerContext(
            projectRoot
          )
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNATURE_REQUIRED"
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "unsigned-executed.txt"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "aurora.lock"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "manifest tampering is rejected before PackageWorker project mutation",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "manifest-tamper-worker",
        `
export async function install(context) {
  await context.createFile(
    "src/manifest-tamper.txt",
    "must never exist"
  );
}
`
      );

    try {
      const signed =
        await signPackage(
          packageArtifact,
          authority
        );

      await writeFile(
        packageArtifact
          .manifestPath,
        JSON.stringify(
          {
            ...signed,
            description:
              "Attacker modified this after signing.",
          },
          null,
          2
        ) + "\n",
        "utf8"
      );

      const worker =
        new PackageWorker(
          packageArtifact
            .packageRoot,
          {},
          createTrustPolicy(
            authority
          )
        );

      await assert.rejects(
        worker.install(
          "manifest-tamper-worker",
          new InstallerContext(
            projectRoot
          )
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNATURE_INVALID"
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "manifest-tamper.txt"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "artifact tampering remains rejected after successful publisher authentication",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "artifact-tamper-worker",
        `
export async function install(context) {
  await context.createFile(
    "src/artifact-tamper.txt",
    "original"
  );
}
`
      );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      /*
       * Keep the signed manifest untouched while changing
       * executable bytes. The signature remains authentic
       * for the manifest, but artifact integrity MUST fail.
       */
      await writeFile(
        packageArtifact
          .installerPath,
        `
export async function install(context) {
  await context.createFile(
    "src/artifact-tamper.txt",
    "tampered executable ran"
  );
}
`,
        "utf8"
      );

      const worker =
        new PackageWorker(
          packageArtifact
            .packageRoot,
          {},
          createTrustPolicy(
            authority
          )
        );

      await assert.rejects(
        worker.install(
          "artifact-tamper-worker",
          new InstallerContext(
            projectRoot
          )
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_INTEGRITY_FAILED"
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "artifact-tamper.txt"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "revoked signing key cannot bypass trust through an installed cache entry",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "cached-revoked",
        `
export async function install() {
  throw new Error(
    "cached package code must never execute"
  );
}
`
      );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      await new CacheManager(
        projectRoot
      ).install(
        "cached-revoked",
        "1.0.0",
        "preexisting-test-checksum"
      );

      const revokedTrust =
        new PackageTrustPolicy({
          requireSignatures:
            true,

          trustedPublishers: [
            {
              id:
                "aurora-tests",
              status:
                "trusted",
              keys: [
                {
                  algorithm:
                    "ed25519",
                  publicKey:
                    authority.publicKey,
                  status:
                    "revoked",
                  reason:
                    "Integration revocation test.",
                },
              ],
            },
          ],
        });

      const worker =
        new PackageWorker(
          packageArtifact
            .packageRoot,
          {},
          revokedTrust
        );

      await assert.rejects(
        worker.install(
          "cached-revoked",
          new InstallerContext(
            projectRoot
          )
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNING_KEY_REVOKED"
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "PackageInstaller rejects unsigned packages during trust preflight with zero project mutation",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const originalPackageJson =
      await readFile(
        join(
          projectRoot,
          "package.json"
        ),
        "utf8"
      );

    const packageArtifact =
      await createPackage(
        "unsigned-installer",
        `
export async function install(context) {
  await context.createFile(
    "src/preflight-bypass.txt",
    "must never exist"
  );
}
`
      );

    try {
      const installer =
        new PackageInstaller({
          packageRoot:
            packageArtifact
              .packageRoot,

          projectRoot,

          trust:
            createTrustOptions(
              authority
            ),
        });

      await assert.rejects(
        installer.install(
          "unsigned-installer"
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNATURE_REQUIRED"
          );

          return true;
        }
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "package.json"
          ),
          "utf8"
        ),
        originalPackageJson
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "preflight-bypass.txt"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "aurora.lock"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "PackageInstaller completes the full trusted signed-package path",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "trusted-installer",
        `
export async function install(context) {
  await context.createFile(
    "src/trusted-installer.txt",
    "trusted installer path"
  );
}
`
      );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      const installer =
        new PackageInstaller({
          packageRoot:
            packageArtifact
              .packageRoot,

          projectRoot,

          trust:
            createTrustOptions(
              authority
            ),
        });

      await installer.install(
        "trusted-installer"
      );

      assert.equal(
        await readFile(
          join(
            projectRoot,
            "src",
            "trusted-installer.txt"
          ),
          "utf8"
        ),
        "trusted installer path"
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          )
        ),
        true
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "aurora.lock"
          )
        ),
        true
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);
test(
  "authoritative manifest loader rejects malformed UTF-8 bytes",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-invalid-utf8-loader-"
        )
      );

    const manifestPath =
      join(
        root,
        "manifest.json"
      );

    await writeFile(
      manifestPath,
      Buffer.from([
        0x7b,
        0x22,
        0x69,
        0x64,
        0x22,
        0x3a,
        0x22,
        0xc3,
        0x28,
        0x22,
        0x7d,
      ])
    );

    try {
      await assert.rejects(
        loadManifest(
          manifestPath
        ),
        error => {
          assert.equal(
            error.code,
            "INVALID_PACKAGE_MANIFEST"
          );

          assert.match(
            String(
              error.cause?.message ??
              ""
            ),
            /valid UTF-8/
          );

          return true;
        }
      );
    }
    finally {
      await cleanup(root);
    }
  }
);

test(
  "PackageInstaller authenticates the root manifest before consuming dependency declarations",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "untrusted-resolution-root",
        `
export async function install(context) {
  await context.createFile(
    "src/untrusted-resolution.txt",
    "must never execute"
  );
}
`,
        {
          dependencies: [
            {
              id:
                "missing-poison-dependency",
              version:
                "^1.0.0",
              optional:
                false,
            },
          ],
        }
      );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      /*
       * No publisher is trusted here.
       *
       * If dependency metadata were consumed first,
       * resolution would attempt to load the missing
       * dependency. Correct ordering rejects the root
       * publisher before that can happen.
       */
      const installer =
        new PackageInstaller({
          packageRoot:
            packageArtifact
              .packageRoot,
          projectRoot,
        });

      await assert.rejects(
        installer.install(
          "untrusted-resolution-root"
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_PUBLISHER_UNTRUSTED"
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "untrusted-resolution.txt"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "aurora.lock"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);

test(
  "PackageInstaller authenticates every dependency before trusting its version or metadata",
  async () => {
    const authority =
      createAuthority();

    const projectRoot =
      await createProject();

    const packageArtifact =
      await createPackage(
        "trusted-resolution-root",
        `
export async function install(context) {
  await context.createFile(
    "src/trusted-resolution-root.txt",
    "must never execute"
  );
}
`,
        {
          dependencies: [
            {
              id:
                "unsigned-dependency",
              version:
                "^1.0.0",
              optional:
                false,
            },
          ],
        }
      );

    const dependencyDirectory =
      join(
        packageArtifact
          .packageRoot,
        "unsigned-dependency"
      );

    await mkdir(
      dependencyDirectory,
      {
        recursive:
          true,
      }
    );

    await writeFile(
      join(
        dependencyDirectory,
        "install.js"
      ),
      `
export async function install(context) {
  await context.createFile(
    "src/unsigned-dependency.txt",
    "must never execute"
  );
}
`,
      "utf8"
    );

    await writePackageManifestV1(
      dependencyDirectory,
      {
        id:
          "unsigned-dependency",
        name:
          "unsigned-dependency",
      }
    );

    try {
      await signPackage(
        packageArtifact,
        authority
      );

      const installer =
        new PackageInstaller({
          packageRoot:
            packageArtifact
              .packageRoot,

          projectRoot,

          trust:
            createTrustOptions(
              authority
            ),
        });

      await assert.rejects(
        installer.install(
          "trusted-resolution-root"
        ),
        error => {
          assert.equal(
            error.code,
            "PACKAGE_SIGNATURE_REQUIRED"
          );

          return true;
        }
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "trusted-resolution-root.txt"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "src",
            "unsigned-dependency.txt"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            ".aurora",
            "cache.json"
          )
        ),
        false
      );

      assert.equal(
        await exists(
          join(
            projectRoot,
            "aurora.lock"
          )
        ),
        false
      );
    }
    finally {
      await cleanup(
        projectRoot,
        packageArtifact
          .packageRoot
      );
    }
  }
);
