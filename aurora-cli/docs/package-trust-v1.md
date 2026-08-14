# Package Trust v1

Package Trust v1 defines how Aurora authenticates package publishers before trusting package metadata or executing package code.

## Security model

Artifact integrity answers:

> Do these package files match the digests declared by the manifest?

Package Trust answers:

> Was this manifest authorized by a publisher whose signing key Aurora trusts?

Aurora uses both controls.

## Raw manifest validation

Before ManifestSchema validation, Aurora requires:

- valid UTF-8;
- no UTF-8 BOM;
- maximum manifest size of 1 MiB;
- maximum JSON nesting depth of 128;
- valid JSON grammar;
- finite numbers;
- well-formed Unicode;
- no duplicate decoded object-property names.

For example, this is rejected:

```json
{
  "id": "first",
  "\u0069d": "second"
}
```

Both property names decode to `id`.

## Signature format

A signed package contains:

```json
{
  "signature": {
    "version": 1,
    "algorithm": "ed25519",
    "keyId": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "value": "canonical-unpadded-base64url-signature"
  }
}
```

Package Trust v1 uses only Ed25519.

The signing key ID is:

```text
lowercase-hex(
  SHA-256(
    canonical Ed25519 SPKI DER public-key bytes
  )
)
```

Trusted public keys use canonical SPKI DER encoded as unpadded base64url.

The Ed25519 signature is 64 bytes and is stored using canonical unpadded base64url.

## Signing payload

Aurora signs:

```text
UTF8("AURORA-PACKAGE-MANIFEST-SIGNATURE-V1")
+
0x00
+
UTF8(canonical-json(signing-document))
```

The signing document contains all Manifest v1 fields.

Only:

```text
signature.value
```

is excluded.

The following remain cryptographically bound:

- package identity;
- version;
- publisher;
- provenance;
- artifact digest;
- file digests;
- dependencies;
- conflicts;
- capabilities;
- compatibility;
- lifecycle state;
- signature version;
- signing algorithm;
- signing key ID.

## Canonical JSON

Aurora uses a strict deterministic JSON serializer.

It is not claimed to be RFC 8785/JCS.

The serializer preserves array order, sorts object keys deterministically, rejects malformed Unicode, rejects non-finite numbers, rejects sparse arrays, rejects getters and custom prototypes, rejects cycles, and rejects non-JSON values.

## Publisher trust

Aurora's trust store binds publisher identities to Ed25519 public keys.

Aurora rejects:

- unknown publishers;
- revoked publishers;
- unknown signing keys;
- revoked signing keys;
- cross-publisher signing-key substitution;
- duplicate publishers;
- duplicate signing keys;
- non-Ed25519 keys.

Signing key IDs are calculated from the actual public-key bytes rather than supplied aliases.

## Error codes

Package Trust v1 uses:

- `PACKAGE_SIGNATURE_REQUIRED`
- `PACKAGE_SIGNATURE_INVALID`
- `PACKAGE_PUBLISHER_UNTRUSTED`
- `PACKAGE_SIGNING_KEY_REVOKED`

Malformed signature schema remains `INVALID_PACKAGE_MANIFEST`.

## Stage 1A compatibility

During Stage 1A:

```text
unsigned + requireSignatures=false
    -> legacy compatibility allowed
```

But:

```text
signature present
    -> signature must verify
```

A bad signature can never silently downgrade into unsigned behavior.

With:

```text
requireSignatures=true
```

unsigned packages fail with `PACKAGE_SIGNATURE_REQUIRED`.

## Verification order

Aurora's package chain is:

```text
raw manifest bytes
    ↓
strict UTF-8 validation
    ↓
duplicate-safe JSON parsing
    ↓
ManifestSchema
    ↓
publisher/signature verification
    ↓
dependency metadata
    ↓
artifact integrity
    ↓
capability policy
    ↓
restricted Node worker
    ↓
host-brokered mutation
```

PackageInstaller verifies trust during preflight.

PackageWorker independently verifies trust at the execution boundary.

Trust verification occurs before PackageWorker's installed-package cache shortcut so key or publisher revocation cannot be bypassed by cache state.

## Artifact integrity

Package Trust does not replace SHA-256 artifact verification.

A package can have a valid publisher signature while its actual executable files have been modified.

In that situation Aurora rejects the package with:

```text
PACKAGE_INTEGRITY_FAILED
```

## Execution boundary

Executable package code runs through Aurora's restricted Node worker process.

Privileged project operations are host brokered and capability checked.

It is not an operating-system sandbox.

## Private signing keys

Production Aurora CLI source must never contain publisher private signing keys.

Private signing keys must not be:

- committed to Git;
- placed in package manifests;
- included in npm packages;
- included in test fixtures;
- printed in logs;
- hard-coded in source.

Tests generate temporary Ed25519 key pairs only in memory.

## Stage 1B

Stage 1A establishes the Package Trust cryptographic and enforcement foundation.

Stage 1B will separately establish Aurora's official publisher signing process, key custody, key rotation and revocation procedures, sign official built-in packages, and deliberately enable signature-required policy.

Stage 1B must not be implemented by committing Aurora's production private signing key to this repository.