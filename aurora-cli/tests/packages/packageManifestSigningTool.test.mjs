import assert from "node:assert/strict";

import {
  spawn,
} from "node:child_process";

import {
  createHash,
  generateKeyPairSync,
} from "node:crypto";

import fs from "node:fs/promises";

import os from "node:os";

import path from "node:path";

import test from "node:test";

import {
  fileURLToPath,
} from "node:url";

import {
  validatePackage,
} from "../../dist/packages/packageValidator.js";

import {
  parsePackageManifestBytes,
} from "../../dist/packages/trust/packageManifestJson.js";

import {
  PackageSignatureVerifier,
} from "../../dist/packages/trust/packageSignatureVerifier.js";

import {
  PackageTrustStore,
} from "../../dist/packages/trust/packageTrustStore.js";

const SIGNER =
  fileURLToPath(
    new URL(
      "../../scripts/sign-package-manifest.mjs",
      import.meta.url
    )
  );

const AUTH_MANIFEST =
  fileURLToPath(
    new URL(
      "../../packages/auth/manifest.json",
      import.meta.url
    )
  );

const TEST_PASSPHRASE =
  "Aurora-Test-Signing-Passphrase-12345";

function createAuthority(
  publisherId =
    "aurora-tests"
) {
  const {
    publicKey,
    privateKey,
  } =
    generateKeyPairSync(
      "ed25519"
    );

  const publicDer =
    Buffer.from(
      publicKey.export({
        format:
          "der",

        type:
          "spki",
      })
    );

  const encodedPublicKey =
    publicDer.toString(
      "base64url"
    );

  const keyId =
    createHash(
      "sha256"
    )
      .update(
        publicDer
      )
      .digest(
        "hex"
      );

  const encryptedPrivateKey =
    privateKey.export({
      format:
        "pem",

      type:
        "pkcs8",

      cipher:
        "aes-256-cbc",

      passphrase:
        TEST_PASSPHRASE,
    });

  return {
    publisherId,
    publicKey:
      encodedPublicKey,
    keyId,
    encryptedPrivateKey,
  };
}

async function createFixture(
  t,
  publisherId =
    "aurora-tests"
) {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "aurora-package-signer-"
      )
    );

  t.after(
    async () => {
      await fs.rm(
        directory,
        {
          recursive:
            true,

          force:
            true,
        }
      );
    }
  );

  const authority =
    createAuthority(
      publisherId
    );

  const privateKeyPath =
    path.join(
      directory,
      "private.pem"
    );

  const metadataPath =
    path.join(
      directory,
      "metadata.json"
    );

  const manifestPath =
    path.join(
      directory,
      "manifest.json"
    );

  const outputPath =
    path.join(
      directory,
      "signed-manifest.json"
    );

  await fs.writeFile(
    privateKeyPath,
    authority.encryptedPrivateKey
  );

  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        version:
          1,

        publisherId:
          authority.publisherId,

        algorithm:
          "ed25519",

        publicKeyEncoding:
          "spki-der-base64url",

        keyId:
          authority.keyId,

        publicKey:
          authority.publicKey,

        createdAt:
          new Date()
            .toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  const sourceManifest =
    JSON.parse(
      await fs.readFile(
        AUTH_MANIFEST,
        "utf8"
      )
    );

  sourceManifest.publisher = {
    ...sourceManifest.publisher,

    id:
      publisherId,

    name:
      "Aurora Test Publisher",
  };

  delete sourceManifest.signature;

  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      sourceManifest,
      null,
      2
    ) + "\n"
  );

  return {
    directory,
    authority,
    privateKeyPath,
    metadataPath,
    manifestPath,
    outputPath,
  };
}

function runSigner({
  manifestPath,
  privateKeyPath,
  metadataPath,
  outputPath,
  passphrase =
    TEST_PASSPHRASE,
}) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const child =
        spawn(
          process.execPath,
          [
            SIGNER,

            "--manifest",
            manifestPath,

            "--private-key",
            privateKeyPath,

            "--metadata",
            metadataPath,

            "--output",
            outputPath,
          ],
          {
            stdio: [
              "pipe",
              "pipe",
              "pipe",
            ],

            windowsHide:
              true,
          }
        );

      let stdout =
        "";

      let stderr =
        "";

      child.stdout.setEncoding(
        "utf8"
      );

      child.stderr.setEncoding(
        "utf8"
      );

      child.stdout.on(
        "data",
        chunk => {
          stdout +=
            chunk;
        }
      );

      child.stderr.on(
        "data",
        chunk => {
          stderr +=
            chunk;
        }
      );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        code => {
          resolve({
            code,
            stdout,
            stderr,
          });
        }
      );

      child.stdin.end(
        passphrase +
        "\n"
      );
    }
  );
}

test(
  "offline signer creates a schema-valid Ed25519 package signature that Aurora verifies",
  async t => {
    const fixture =
      await createFixture(
        t
      );

    const result =
      await runSigner(
        fixture
      );

    assert.equal(
      result.code,
      0,
      result.stderr
    );

    assert.equal(
      result.stderr,
      ""
    );

    assert.doesNotMatch(
      result.stdout,
      new RegExp(
        TEST_PASSPHRASE
      )
    );

    const signed =
      validatePackage(
        parsePackageManifestBytes(
          await fs.readFile(
            fixture.outputPath
          )
        ),
        fixture.outputPath
      );

    assert.equal(
      signed.signature?.version,
      1
    );

    assert.equal(
      signed.signature?.algorithm,
      "ed25519"
    );

    assert.equal(
      signed.signature?.keyId,
      fixture.authority.keyId
    );

    const verifier =
      new PackageSignatureVerifier(
        new PackageTrustStore([
          {
            id:
              fixture.authority.publisherId,

            status:
              "trusted",

            keys: [
              {
                algorithm:
                  "ed25519",

                publicKey:
                  fixture.authority.publicKey,

                status:
                  "trusted",
              },
            ],
          },
        ])
      );

    const verification =
      verifier.verify(
        signed
      );

    assert.equal(
      verification.publisherId,
      fixture.authority.publisherId
    );

    assert.equal(
      verification.keyId,
      fixture.authority.keyId
    );
  }
);

test(
  "offline signer refuses to replace an existing package signature",
  async t => {
    const fixture =
      await createFixture(
        t
      );

    const first =
      await runSigner(
        fixture
      );

    assert.equal(
      first.code,
      0,
      first.stderr
    );

    const secondOutput =
      path.join(
        fixture.directory,
        "second-signed.json"
      );

    const second =
      await runSigner({
        ...fixture,

        manifestPath:
          fixture.outputPath,

        outputPath:
          secondOutput,
      });

    assert.notEqual(
      second.code,
      0
    );

    assert.match(
      second.stderr,
      /already contains a signature/
    );

    await assert.rejects(
      fs.access(
        secondOutput
      )
    );
  }
);

test(
  "offline signer rejects a private key that does not match public signing metadata",
  async t => {
    const fixture =
      await createFixture(
        t
      );

    const wrongAuthority =
      createAuthority(
        fixture.authority.publisherId
      );

    const wrongPrivateKeyPath =
      path.join(
        fixture.directory,
        "wrong-private.pem"
      );

    await fs.writeFile(
      wrongPrivateKeyPath,
      wrongAuthority.encryptedPrivateKey
    );

    const result =
      await runSigner({
        ...fixture,

        privateKeyPath:
          wrongPrivateKeyPath,
      });

    assert.notEqual(
      result.code,
      0
    );

    assert.match(
      result.stderr,
      /does not match the supplied public signing metadata/
    );

    assert.doesNotMatch(
      result.stderr,
      new RegExp(
        TEST_PASSPHRASE
      )
    );

    await assert.rejects(
      fs.access(
        fixture.outputPath
      )
    );
  }
);

test(
  "offline signer rejects a manifest whose publisher differs from signing metadata",
  async t => {
    const fixture =
      await createFixture(
        t
      );

    const manifest =
      JSON.parse(
        await fs.readFile(
          fixture.manifestPath,
          "utf8"
        )
      );

    manifest.publisher.id =
      "other-publisher";

    await fs.writeFile(
      fixture.manifestPath,
      JSON.stringify(
        manifest,
        null,
        2
      ) + "\n"
    );

    const result =
      await runSigner(
        fixture
      );

    assert.notEqual(
      result.code,
      0
    );

    assert.match(
      result.stderr,
      /does not match signing metadata publisher/
    );

    await assert.rejects(
      fs.access(
        fixture.outputPath
      )
    );
  }
);

test(
  "offline signer refuses in-place manifest mutation",
  async t => {
    const fixture =
      await createFixture(
        t
      );

    const before =
      await fs.readFile(
        fixture.manifestPath
      );

    const result =
      await runSigner({
        ...fixture,

        outputPath:
          fixture.manifestPath,
      });

    assert.notEqual(
      result.code,
      0
    );

    assert.match(
      result.stderr,
      /never modifies a source manifest in place/
    );

    const after =
      await fs.readFile(
        fixture.manifestPath
      );

    assert.deepEqual(
      after,
      before
    );
  }
);
