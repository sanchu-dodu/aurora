import assert from "node:assert/strict";

import {
  spawn,
} from "node:child_process";

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
  gunzipSync,
} from "node:zlib";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  PackagePublicationWriter,
  VerifiedPackagePublicationBuilder,
} from "../../dist/packages/publish/packagePublicationBundle.js";

import {
  PackagePublisher,
} from "../../dist/packages/publish/packagePublisher.js";

import {
  canonicalizeJson,
} from "../../dist/packages/trust/packageCanonicalJson.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
} from "../../dist/packages/trust/packageSigningKey.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  writePackageManifestV1,
} from "./manifestTestUtils.mjs";

const TAR_BLOCK_BYTES =
  512;

function sha256(value) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
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

function trustOptions(authority) {
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
  };
}

async function signManifest(
  manifestPath,
  authority
) {
  const manifest =
    JSON.parse(
      await fs.readFile(
        manifestPath,
        "utf8"
      )
    );

  const candidate = {
    ...manifest,
    signature: {
      version: 1,
      algorithm:
        "ed25519",
      keyId:
        authority.keyId,
      value:
        "",
    },
  };

  const signed = {
    ...candidate,
    signature: {
      ...candidate.signature,
      value:
        sign(
          null,
          createPackageSigningPayload(
            candidate
          ),
          authority.privateKey
        ).toString(
          "base64url"
        ),
    },
  };

  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      signed,
      null,
      2
    )}\n`,
    "utf8"
  );

  return signed;
}

async function createFixture(
  context,
  {
    signed = true,
    revoked = false,
  } = {}
) {
  const workspaceRoot =
    await fs.mkdtemp(
      join(
        tmpdir(),
        "aurora-package-publication-"
      )
    );

  context.after(
    async () => {
      await fs.rm(
        workspaceRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  );

  const packageRoot =
    join(
      workspaceRoot,
      "packages",
      "alpha"
    );

  await fs.mkdir(
    join(
      packageRoot,
      "templates"
    ),
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    join(
      packageRoot,
      "payload.txt"
    ),
    "verified publication payload\n",
    "utf8"
  );

  await fs.writeFile(
    join(
      packageRoot,
      "templates",
      "view.ts.template"
    ),
    "export const view = true;\n",
    "utf8"
  );

  await writePackageManifestV1(
    packageRoot,
    {
      id:
        "alpha",
      version:
        "1.2.3",
      lifecycle:
        revoked
          ? {
              deprecated:
                false,
              revoked:
                true,
              reason:
                "Revoked for publication test.",
            }
          : {
              deprecated:
                false,
              revoked:
                false,
            },
    }
  );

  const authority =
    createAuthority();

  if (signed) {
    await signManifest(
      join(
        packageRoot,
        "manifest.json"
      ),
      authority
    );
  }

  return {
    workspaceRoot,
    packageRoot,
    authority,
    trust:
      trustOptions(
        authority
      ),
  };
}

function readTarEntries(
  archive
) {
  const tar =
    gunzipSync(archive);

  const entries = [];
  let offset = 0;

  while (
    offset +
      TAR_BLOCK_BYTES <=
    tar.byteLength
  ) {
    const header =
      tar.subarray(
        offset,
        offset +
          TAR_BLOCK_BYTES
      );

    offset +=
      TAR_BLOCK_BYTES;

    if (
      header.every(
        byte => byte === 0
      )
    ) {
      break;
    }

    const readText =
      (
        start,
        length
      ) => {
        const field =
          header.subarray(
            start,
            start + length
          );

        const end =
          field.indexOf(0);

        return field.subarray(
          0,
          end === -1
            ? field.byteLength
            : end
        ).toString("ascii");
      };

    const name =
      readText(0, 100);

    const prefix =
      readText(345, 155);

    const size =
      Number.parseInt(
        readText(124, 12),
        8
      );

    entries.push({
      path:
        prefix
          ? `${prefix}/${name}`
          : name,
      mode:
        readText(100, 8),
      uid:
        readText(108, 8),
      gid:
        readText(116, 8),
      mtime:
        readText(136, 12),
      type:
        header[156],
      content:
        Buffer.from(
          tar.subarray(
            offset,
            offset + size
          )
        ),
    });

    offset +=
      size +
      (
        (
          TAR_BLOCK_BYTES -
          (
            size %
            TAR_BLOCK_BYTES
          )
        ) %
        TAR_BLOCK_BYTES
      );
  }

  return entries;
}

async function runCli(
  workspaceRoot,
  args
) {
  const environment = {
    ...process.env,
  };

  delete environment.NO_COLOR;
  delete environment.FORCE_COLOR;

  return new Promise(
    (
      resolve,
      reject
    ) => {
      const child =
        spawn(
          process.execPath,
          [
            join(
              process.cwd(),
              "dist",
              "index.js"
            ),
            ...args,
          ],
          {
            cwd:
              workspaceRoot,
            env:
              environment,
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
            windowsHide:
              true,
          }
        );

      const stdout = [];
      const stderr = [];

      child.stdout.on(
        "data",
        chunk => stdout.push(
          Buffer.from(chunk)
        )
      );

      child.stderr.on(
        "data",
        chunk => stderr.push(
          Buffer.from(chunk)
        )
      );

      child.once(
        "error",
        reject
      );

      child.once(
        "close",
        code => resolve({
          code,
          stdout:
            Buffer.concat(
              stdout
            ).toString("utf8"),
          stderr:
            Buffer.concat(
              stderr
            ).toString("utf8"),
        })
      );
    }
  );
}

test(
  "the signed official auth package has one cross-platform canonical publication digest",
  async () => {
    const bundle =
      await new VerifiedPackagePublicationBuilder()
        .build(
          join(
            process.cwd(),
            "packages",
            "auth"
          )
        );

    assert.equal(
      bundle.receipt
        .manifestDigest,
      "a665f754019af336eb09079ebe861c66fdd99c79f2907c9a1a151337669c6340"
    );

    assert.equal(
      bundle.receipt.archive
        .digest,
      "d7943bfdd1bd9584a2fe2daa96955713c3bbb3a95a976766aeef3486069b80f8"
    );

    assert.equal(
      bundle.receipt.archive
        .size,
      1420
    );
  }
);

test(
  "verified publication bundles are deterministic, canonical, and content addressed",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const builder =
      new VerifiedPackagePublicationBuilder({
        trust:
          fixture.trust,
      });

    const first =
      await builder.build(
        fixture.packageRoot
      );

    const second =
      await builder.build(
        fixture.packageRoot
      );

    const firstArchive =
      first.archiveBytes();

    const secondArchive =
      second.archiveBytes();

    assert.deepEqual(
      secondArchive,
      firstArchive
    );

    assert.deepEqual(
      second.receipt,
      first.receipt
    );

    assert.equal(
      firstArchive[0],
      0x1f
    );

    assert.equal(
      firstArchive[1],
      0x8b
    );

    assert.deepEqual(
      [...firstArchive.subarray(
        4,
        8
      )],
      [0, 0, 0, 0]
    );

    assert.equal(
      firstArchive[9],
      0xff
    );

    assert.equal(
      first.receipt.archive
        .digest,
      sha256(firstArchive)
    );

    assert.equal(
      first.receipt.archive
        .size,
      firstArchive.byteLength
    );

    assert.equal(
      first.receipt.signature
        .keyId,
      fixture.authority.keyId
    );

    const receiptDocument =
      first.receiptBytes();

    assert.equal(
      receiptDocument.toString(
        "utf8"
      ),
      `${canonicalizeJson(
        first.receipt
      )}\n`
    );

    const entries =
      readTarEntries(
        firstArchive
      );

    assert.deepEqual(
      entries.map(
        entry => entry.path
      ),
      [
        "manifest.json",
        "payload.txt",
        "templates/view.ts.template",
      ]
    );

    for (const entry of entries) {
      assert.equal(
        entry.mode,
        "0000600"
      );
      assert.equal(
        entry.uid,
        "0000000"
      );
      assert.equal(
        entry.gid,
        "0000000"
      );
      assert.equal(
        entry.mtime,
        "00000000000"
      );
      assert.equal(
        entry.type,
        "0".charCodeAt(0)
      );
    }
  }
);

test(
  "publisher commits one exact bundle atomically and reuses only identical content",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const publisher =
      new PackagePublisher({
        workspaceRoot:
          fixture.workspaceRoot,
        trust:
          fixture.trust,
      });

    const first =
      await publisher.publish(
        fixture.packageRoot
      );

    const archiveBefore =
      await fs.readFile(
        first.archivePath
      );

    const receiptBefore =
      await fs.readFile(
        first.receiptPath
      );

    const second =
      await publisher.publish(
        fixture.packageRoot
      );

    assert.equal(
      second.bundlePath,
      first.bundlePath
    );

    assert.deepEqual(
      await fs.readFile(
        second.archivePath
      ),
      archiveBefore
    );

    assert.deepEqual(
      await fs.readFile(
        second.receiptPath
      ),
      receiptBefore
    );

    assert.deepEqual(
      await fs.readdir(
        join(
          fixture.workspaceRoot,
          ".aurora",
          "publications"
        )
      ),
      ["alpha"]
    );
  }
);

test(
  "publication preview returns the exact receipt without writing files",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const receipt =
      await new PackagePublisher({
        workspaceRoot:
          fixture.workspaceRoot,
        trust:
          fixture.trust,
      }).prepare(
        fixture.packageRoot
      );

    assert.equal(
      receipt.packageId,
      "alpha"
    );

    assert.equal(
      receipt.version,
      "1.2.3"
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "package publish command previews and writes the verified official bundle end to end",
  async context => {
    const workspaceRoot =
      await fs.mkdtemp(
        join(
          tmpdir(),
          "aurora-package-publish-command-"
        )
      );

    context.after(
      async () => {
        await fs.rm(
          workspaceRoot,
          {
            recursive: true,
            force: true,
          }
        );
      }
    );

    await fs.mkdir(
      join(
        workspaceRoot,
        "packages"
      )
    );

    await fs.cp(
      join(
        process.cwd(),
        "packages",
        "auth"
      ),
      join(
        workspaceRoot,
        "packages",
        "auth"
      ),
      {
        recursive: true,
      }
    );

    const preview =
      await runCli(
        workspaceRoot,
        [
          "package",
          "publish",
          "auth",
          "--dry-run",
        ]
      );

    assert.equal(
      preview.code,
      0,
      JSON.stringify(preview)
    );

    assert.match(
      preview.stdout,
      /Verified publication bundle preview/u
    );

    assert.match(
      preview.stdout,
      /no publication files were written/u
    );

    await assert.rejects(
      fs.access(
        join(
          workspaceRoot,
          ".aurora"
        )
      )
    );

    const published =
      await runCli(
        workspaceRoot,
        [
          "package",
          "publish",
          "auth",
        ]
      );

    assert.equal(
      published.code,
      0,
      JSON.stringify(published)
    );

    assert.match(
      published.stdout,
      /Verified publication bundle created/u
    );

    const publicationRoot =
      join(
        workspaceRoot,
        ".aurora",
        "publications",
        "auth",
        "1.0.0",
        "d7943bfdd1bd9584a2fe2daa96955713c3bbb3a95a976766aeef3486069b80f8"
      );

    await Promise.all([
      fs.access(
        join(
          publicationRoot,
          "package.tar.gz"
        )
      ),
      fs.access(
        join(
          publicationRoot,
          "publication.json"
        )
      ),
    ]);
  }
);

test(
  "publisher refuses to overwrite mismatched content at a content-addressed target",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const publisher =
      new PackagePublisher({
        workspaceRoot:
          fixture.workspaceRoot,
        trust:
          fixture.trust,
      });

    const first =
      await publisher.publish(
        fixture.packageRoot
      );

    await fs.writeFile(
      first.archivePath,
      "collision"
    );

    await assert.rejects(
      () =>
        publisher.publish(
          fixture.packageRoot
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_PUBLICATION_FAILED
        );
        assert.match(
          error.message,
          /does not match.*bundle bytes/u
        );
        return true;
      }
    );

    assert.equal(
      await fs.readFile(
        first.archivePath,
        "utf8"
      ),
      "collision"
    );
  }
);

test(
  "publication requires publisher trust before creating output",
  async context => {
    const fixture =
      await createFixture(
        context,
        {
          signed: false,
        }
      );

    await assert.rejects(
      () =>
        new PackagePublisher({
          workspaceRoot:
            fixture.workspaceRoot,
        }).publish(
          fixture.packageRoot
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_SIGNATURE_REQUIRED
        );
        return true;
      }
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "revoked packages cannot produce publication output",
  async context => {
    const fixture =
      await createFixture(
        context,
        {
          revoked: true,
        }
      );

    await assert.rejects(
      () =>
        new PackagePublisher({
          workspaceRoot:
            fixture.workspaceRoot,
          trust:
            fixture.trust,
        }).publish(
          fixture.packageRoot
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_REVOKED
        );
        return true;
      }
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "tampered and undeclared package files fail before publication output",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const publisher =
      new PackagePublisher({
        workspaceRoot:
          fixture.workspaceRoot,
        trust:
          fixture.trust,
      });

    await fs.writeFile(
      join(
        fixture.packageRoot,
        "payload.txt"
      ),
      "tampered\n"
    );

    await assert.rejects(
      () =>
        publisher.publish(
          fixture.packageRoot
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
        );
        return true;
      }
    );

    await fs.writeFile(
      join(
        fixture.packageRoot,
        "undeclared.txt"
      ),
      "undeclared\n"
    );

    await assert.rejects(
      () =>
        publisher.publish(
          fixture.packageRoot
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
        );
        return true;
      }
    );

    await assert.rejects(
      fs.access(
        join(
          fixture.workspaceRoot,
          ".aurora"
        )
      )
    );
  }
);

test(
  "publication enforces its bounded input policy and authentic bundle receipts",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    await assert.rejects(
      () =>
        new VerifiedPackagePublicationBuilder({
          trust:
            fixture.trust,
          maxInputBytes: 64,
        }).build(
          fixture.packageRoot
        ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .PACKAGE_PUBLICATION_FAILED
        );
        return true;
      }
    );

    const authentic =
      await new VerifiedPackagePublicationBuilder({
        trust:
          fixture.trust,
      }).build(
        fixture.packageRoot
      );

    await assert.rejects(
      () =>
        new PackagePublicationWriter({
          workspaceRoot:
            fixture.workspaceRoot,
        }).write({
          ...authentic,
        }),
      TypeError
    );
  }
);

test(
  "publisher rejects package roots outside its exact workspace before publication",
  async context => {
    const fixture =
      await createFixture(
        context
      );

    const isolatedWorkspace =
      join(
        fixture.workspaceRoot,
        "isolated-workspace"
      );

    await fs.mkdir(
      isolatedWorkspace
    );

    await assert.rejects(
      () =>
        new PackagePublisher({
          workspaceRoot:
            isolatedWorkspace,
          trust:
            fixture.trust,
        }).publish(
          fixture.packageRoot
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

    assert.deepEqual(
      await fs.readdir(
        isolatedWorkspace
      ),
      []
    );
  }
);
