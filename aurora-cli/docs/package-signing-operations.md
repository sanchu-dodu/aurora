# Aurora Package Signing Operations

This document defines the maintainer procedure for Aurora Package Trust v1 signing-key custody, signing, rotation, revocation, recovery, and release validation.

## Security boundary

Aurora production source contains only public package-verification material.

Production private signing material must remain outside:

- the Git repository;
- Git history;
- package manifests;
- npm package contents;
- test fixtures;
- source-code constants;
- command-line arguments;
- environment variables;
- terminal output;
- application logs.

The maintainer signing utility is:

```text
scripts/sign-package-manifest.mjs
```

It is a repository-maintenance tool, not package runtime functionality.

## Official publisher identity

```text
Publisher: aurora-technologies
Algorithm: ed25519
Key ID: ef17eff013d58423f6f6968dda03c01f9ea151b2b20a6466318228945d753591
Public-key encoding: spki-der-base64url
Public SPKI: MCowBQYDK2VwAyEAlqu_eouLNik7Bd6UgMZl3_i_iHOl0N9tVh0Ac96GWFw
```

The key ID is the lowercase hexadecimal SHA-256 fingerprint of the Ed25519 SPKI DER public-key bytes.

## Private-key custody

The private key must be kept outside the repository as encrypted PKCS#8 material or in an appropriate hardware-backed or managed signing system.

The signing passphrase must not be supplied through:

- command-line arguments;
- environment variables;
- committed configuration files;
- logs.

For the local maintainer workflow, the passphrase is entered interactively and passed to the signing process through standard input only.

A locally encrypted private-key file is not equivalent to HSM-grade custody.

Before a production release depends on a signing key, maintainers must establish a separately controlled encrypted recovery copy or equivalent managed-key recovery mechanism and test the recovery procedure.

## Public signing metadata

Public signing metadata identifies:

- version;
- publisherId;
- algorithm;
- publicKeyEncoding;
- publicKey;
- keyId;
- createdAt.

Before signing, Aurora verifies that the public key fingerprints to the declared key ID and that the supplied private key derives the same public identity.

A mismatch fails closed before a signed manifest is written.

## Signing procedure

1. Start from a reviewed package manifest.
2. Build Aurora CLI so the current Package Trust implementation is available.
3. Verify external public metadata against the expected Aurora publisher identity.
4. Enter the private-key passphrase interactively.
5. Sign to a new output path outside the package manifest location.
6. Never sign in place.
7. Verify the candidate through Aurora's production signature verifier.
8. Confirm that no manifest field changed except the signature envelope.
9. Verify artifact integrity independently.
10. Promote the candidate only after all verification succeeds.
11. Run the complete security, regression, and release-validation suites.

The signer must refuse to overwrite an existing output file.

## Rotation procedure

Key rotation must preserve an authenticated transition.

Use this order:

1. Generate a new Ed25519 key pair outside the repository.
2. Establish secure custody and recovery for the new private key.
3. Calculate the new public SPKI and key ID.
4. Add the new public key to the existing publisher trust record with status trusted.
5. Keep the previous public key trusted during an overlap window.
6. Release Aurora containing both trusted public keys.
7. Sign new package manifests with the replacement private key.
8. Verify those manifests against the overlapping trust configuration.
9. Release the newly signed packages.
10. After migration, mark the previous public key revoked with a non-empty reason.
11. Do not silently delete the retired key while artifacts signed by it can still be encountered.

The overlap window prevents a trust deadlock where packages are signed by a key that deployed Aurora versions do not yet recognize.

## Revocation procedure

If a signing key is compromised or must no longer authorize packages:

1. Stop using the affected private key immediately.
2. Generate or activate a replacement key.
3. Add the replacement public key as trusted if needed.
4. Mark the affected public key revoked.
5. Record a concise non-empty revocation reason.
6. Re-sign current official manifests with the active replacement key.
7. Run signature, artifact, execution, and release checks.
8. Publish the trust update and replacement signatures.
9. Preserve the revoked public key in the publisher trust record.

Aurora intentionally distinguishes a revoked signing key from an unknown signing key.

An explicitly revoked signing key fails with:

```text
PACKAGE_SIGNING_KEY_REVOKED
```

A key absent from the publisher trust record fails as untrusted.

Retaining the retired public key as revoked preserves the security distinction and provides a clear incident signal.

## Publisher revocation

Publisher revocation is broader than key revocation.

If the publisher itself is no longer trusted, mark the publisher revoked with a non-empty reason.

Packages claiming that publisher then fail publisher trust regardless of which publisher key signed them.

## Lost key without suspected compromise

1. Attempt recovery through the approved recovery copy or managed-key service.
2. Verify the recovered private key against the expected public SPKI and key ID before use.
3. If recovery is impossible, generate a replacement key pair and follow the rotation procedure.
4. Never attempt to reconstruct private signing material from public metadata.
5. Never disable signature enforcement merely to work around key loss.

## Compromise response

1. Treat the key as compromised rather than merely lost.
2. Stop signing with it.
3. Revoke its public key with a documented reason.
4. Establish a replacement signing key.
5. Re-sign all currently supported official package manifests.
6. Audit recently signed manifests and release history.
7. Verify that compromised private material never entered Git, npm artifacts, logs, CI artifacts, or test fixtures.

## Release gate

Before a Package Trust production release:

- every official built-in manifest must carry a valid signature;
- the default package policy must require signatures;
- official public trust must resolve the active signing key;
- revoked keys must remain represented as revoked where needed;
- private signing material must not exist in repository or npm-package contents;
- the full test suite must pass;
- installed-package release validation must pass;
- Git diff hygiene must pass;
- recovery and rotation procedures must be documented.

Private-key backup custody is an operational security requirement and is not satisfied merely by retaining one encrypted local file.
