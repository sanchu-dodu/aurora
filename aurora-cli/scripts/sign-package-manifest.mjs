"use strict";

import {
  createPrivateKey,
  createPublicKey,
  sign as signSignature,
  verify as verifySignature,
} from "node:crypto";

import fs from "node:fs/promises";

import path from "node:path";

import {
  validatePackage,
} from "../dist/packages/packageValidator.js";

import {
  parsePackageManifestBytes,
} from "../dist/packages/trust/packageManifestJson.js";

import {
  encodeEd25519PublicKeySpki,
  fingerprintEd25519PublicKey,
  fingerprintEncodedEd25519PublicKey,
} from "../dist/packages/trust/packageSigningKey.js";

import {
  createPackageSigningPayload,
} from "../dist/packages/trust/packageSigningPayload.js";

import {
  isPackageKeyId,
  isPackageSignatureValue,
  PACKAGE_PUBLIC_KEY_ENCODING,
  PACKAGE_SIGNATURE_BYTE_LENGTH,
  PACKAGE_SIGNATURE_VERSION,
  PACKAGE_SIGNING_ALGORITHM,
} from "../dist/packages/trust/packageTrustTypes.js";

const REQUIRED_OPTIONS =
  Object.freeze([
    "--manifest",
    "--private-key",
    "--metadata",
    "--output",
  ]);

function parseArguments(
  args
) {
  if (
    args.length !==
    REQUIRED_OPTIONS.length * 2
  ) {
    throw new Error(
      "Expected --manifest, --private-key, --metadata, and --output."
    );
  }

  const values =
    new Map();

  for (
    let index = 0;
    index < args.length;
    index += 2
  ) {
    const option =
      args[index];

    const value =
      args[index + 1];

    if (
      !REQUIRED_OPTIONS.includes(
        option
      )
    ) {
      throw new Error(
        `Unknown signing option '${String(option)}'.`
      );
    }

    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error(
        `Signing option '${option}' requires a value.`
      );
    }

    if (
      values.has(
        option
      )
    ) {
      throw new Error(
        `Signing option '${option}' was provided more than once.`
      );
    }

    values.set(
      option,
      value
    );
  }

  for (
    const option
    of REQUIRED_OPTIONS
  ) {
    if (
      !values.has(
        option
      )
    ) {
      throw new Error(
        `Missing required signing option '${option}'.`
      );
    }
  }

  return {
    manifestPath:
      path.resolve(
        values.get(
          "--manifest"
        )
      ),

    privateKeyPath:
      path.resolve(
        values.get(
          "--private-key"
        )
      ),

    metadataPath:
      path.resolve(
        values.get(
          "--metadata"
        )
      ),

    outputPath:
      path.resolve(
        values.get(
          "--output"
        )
      ),
  };
}

async function assertRegularFile(
  file,
  label
) {
  const information =
    await fs.lstat(
      file
    );

  if (
    information.isSymbolicLink() ||
    !information.isFile()
  ) {
    throw new Error(
      `${label} must be a regular non-symbolic-link file.`
    );
  }
}

function assertExactMetadataShape(
  metadata
) {
  const expected =
    [
      "algorithm",
      "createdAt",
      "keyId",
      "publicKey",
      "publicKeyEncoding",
      "publisherId",
      "version",
    ].sort();

  const actual =
    Object.keys(
      metadata
    ).sort();

  if (
    expected.length !==
      actual.length ||
    expected.some(
      (key, index) =>
        key !==
        actual[index]
    )
  ) {
    throw new Error(
      "Signing metadata contains missing or unexpected properties."
    );
  }

  if (
    metadata.version !== 1
  ) {
    throw new Error(
      "Signing metadata version is unsupported."
    );
  }

  if (
    metadata.algorithm !==
    PACKAGE_SIGNING_ALGORITHM
  ) {
    throw new Error(
      "Signing metadata algorithm must be Ed25519."
    );
  }

  if (
    metadata.publicKeyEncoding !==
    PACKAGE_PUBLIC_KEY_ENCODING
  ) {
    throw new Error(
      "Signing metadata public-key encoding is unsupported."
    );
  }

  if (
    typeof metadata.publisherId !==
      "string" ||
    metadata.publisherId.length ===
      0
  ) {
    throw new Error(
      "Signing metadata publisherId is invalid."
    );
  }

  if (
    typeof metadata.keyId !==
      "string" ||
    !isPackageKeyId(
      metadata.keyId
    )
  ) {
    throw new Error(
      "Signing metadata keyId is invalid."
    );
  }

  if (
    typeof metadata.publicKey !==
      "string" ||
    metadata.publicKey.length ===
      0
  ) {
    throw new Error(
      "Signing metadata public key is invalid."
    );
  }

  if (
    typeof metadata.createdAt !==
      "string" ||
    Number.isNaN(
      Date.parse(
        metadata.createdAt
      )
    )
  ) {
    throw new Error(
      "Signing metadata creation timestamp is invalid."
    );
  }

  const metadataKeyId =
    fingerprintEncodedEd25519PublicKey(
      metadata.publicKey
    );

  if (
    metadataKeyId !==
    metadata.keyId
  ) {
    throw new Error(
      "Signing metadata public key does not match its keyId."
    );
  }
}

function attachSignature(
  manifest,
  signature
) {
  const result =
    {};

  let inserted =
    false;

  for (
    const [
      key,
      value,
    ]
    of Object.entries(
      manifest
    )
  ) {
    if (
      key ===
      "signature"
    ) {
      continue;
    }

    result[key] =
      value;

    if (
      key ===
      "publisher"
    ) {
      result.signature =
        signature;

      inserted =
        true;
    }
  }

  if (!inserted) {
    throw new Error(
      "Package manifest does not contain publisher metadata."
    );
  }

  return result;
}

async function main() {
  const {
    manifestPath,
    privateKeyPath,
    metadataPath,
    outputPath,
  } =
    parseArguments(
      process.argv.slice(
        2
      )
    );

  if (
    manifestPath ===
    outputPath
  ) {
    throw new Error(
      "The signing utility never modifies a source manifest in place."
    );
  }

  await assertRegularFile(
    manifestPath,
    "Package manifest"
  );

  await assertRegularFile(
    privateKeyPath,
    "Private signing key"
  );

  await assertRegularFile(
    metadataPath,
    "Signing metadata"
  );

  const outputParent =
    path.dirname(
      outputPath
    );

  const outputParentInfo =
    await fs.lstat(
      outputParent
    );

  if (
    outputParentInfo.isSymbolicLink() ||
    !outputParentInfo.isDirectory()
  ) {
    throw new Error(
      "Signing output directory must be an existing non-symbolic-link directory."
    );
  }

  try {
    await fs.access(
      outputPath
    );

    throw new Error(
      "Signing output already exists and will not be overwritten."
    );
  }
  catch (error) {
    if (
      error?.code !==
      "ENOENT"
    ) {
      throw error;
    }
  }

  /*
   * Read the signing metadata through Aurora's
   * strict JSON byte parser as well. This prevents
   * duplicate decoded properties or malformed UTF-8
   * from creating an ambiguous signing identity.
   */

  const metadata =
    parsePackageManifestBytes(
      await fs.readFile(
        metadataPath
      )
    );

  assertExactMetadataShape(
    metadata
  );

  const rawManifest =
    await fs.readFile(
      manifestPath
    );

  const parsedManifest =
    parsePackageManifestBytes(
      rawManifest
    );

  /*
   * Sign the same schema-normalized manifest object
   * that Aurora will later verify.
   */

  const manifest =
    validatePackage(
      parsedManifest,
      manifestPath
    );

  if (
    manifest.signature
  ) {
    throw new Error(
      `Package '${manifest.id}' already contains a signature; refusing to replace it.`
    );
  }

  if (
    manifest.publisher.id !==
    metadata.publisherId
  ) {
    throw new Error(
      `Package publisher '${manifest.publisher.id}' does not match signing metadata publisher '${metadata.publisherId}'.`
    );
  }

  /*
   * The passphrase is supplied only through stdin.
   * It is never accepted as a command-line argument.
   */

  process.stdin.setEncoding(
    "utf8"
  );

  let passphrase =
    "";

  for await (
    const chunk
    of process.stdin
  ) {
    passphrase +=
      chunk;

    if (
      passphrase.length >
      4096
    ) {
      throw new Error(
        "Signing-key passphrase input is unexpectedly large."
      );
    }
  }

  passphrase =
    passphrase.replace(
      /\r?\n$/,
      ""
    );

  if (
    passphrase.length ===
    0
  ) {
    throw new Error(
      "Signing-key passphrase was not supplied on stdin."
    );
  }

  let privateKey;

  try {
    privateKey =
      createPrivateKey({
        key:
          await fs.readFile(
            privateKeyPath
          ),

        format:
          "pem",

        passphrase,
      });
  }
  catch {
    throw new Error(
      "Encrypted private signing key could not be opened."
    );
  }

  if (
    privateKey.type !==
      "private" ||
    privateKey.asymmetricKeyType !==
      PACKAGE_SIGNING_ALGORITHM
  ) {
    throw new Error(
      "Private signing key must be Ed25519."
    );
  }

  const derivedPublicKey =
    createPublicKey(
      privateKey
    );

  const derivedPublicKeyEncoded =
    encodeEd25519PublicKeySpki(
      derivedPublicKey
    );

  const derivedKeyId =
    fingerprintEd25519PublicKey(
      derivedPublicKey
    );

  if (
    derivedPublicKeyEncoded !==
      metadata.publicKey ||
    derivedKeyId !==
      metadata.keyId
  ) {
    throw new Error(
      "Private signing key does not match the supplied public signing metadata."
    );
  }

  /*
   * signature.value is deliberately omitted from
   * the cryptographic payload by
   * createPackageSigningPayload().
   */

  const signingDraft =
    attachSignature(
      manifest,
      {
        version:
          PACKAGE_SIGNATURE_VERSION,

        algorithm:
          PACKAGE_SIGNING_ALGORITHM,

        keyId:
          metadata.keyId,

        value:
          "",
      }
    );

  const payload =
    createPackageSigningPayload(
      signingDraft
    );

  const signatureBytes =
    signSignature(
      null,
      payload,
      privateKey
    );

  if (
    signatureBytes.byteLength !==
    PACKAGE_SIGNATURE_BYTE_LENGTH
  ) {
    throw new Error(
      "Ed25519 signing produced an unexpected signature length."
    );
  }

  const signatureValue =
    signatureBytes.toString(
      "base64url"
    );

  if (
    !isPackageSignatureValue(
      signatureValue
    )
  ) {
    throw new Error(
      "Ed25519 signing produced a non-canonical signature value."
    );
  }

  const signedCandidate =
    attachSignature(
      manifest,
      {
        version:
          PACKAGE_SIGNATURE_VERSION,

        algorithm:
          PACKAGE_SIGNING_ALGORITHM,

        keyId:
          metadata.keyId,

        value:
          signatureValue,
      }
    );

  const signedManifest =
    validatePackage(
      signedCandidate,
      `${manifestPath} signed output`
    );

  /*
   * Verify before writing anything.
   */

  const verified =
    verifySignature(
      null,
      createPackageSigningPayload(
        signedManifest
      ),
      derivedPublicKey,
      signatureBytes
    );

  if (!verified) {
    throw new Error(
      "Generated package signature failed immediate verification."
    );
  }

  const serialized =
    JSON.stringify(
      signedManifest,
      null,
      2
    ) + "\n";

  /*
   * wx is intentional: no existing output can be
   * silently replaced.
   */

  await fs.writeFile(
    outputPath,
    serialized,
    {
      encoding:
        "utf8",

      flag:
        "wx",
    }
  );

  console.log(
    JSON.stringify({
      packageId:
        signedManifest.id,

      packageVersion:
        signedManifest.version,

      publisherId:
        signedManifest.publisher.id,

      algorithm:
        PACKAGE_SIGNING_ALGORITHM,

      keyId:
        metadata.keyId,

      output:
        outputPath,
    })
  );
}

main()
  .catch(
    error => {
      const message =
        error instanceof Error
          ? error.message
          : String(
              error
            );

      console.error(
        `Package signing failed: ${message}`
      );

      process.exitCode =
        1;
    }
  );
