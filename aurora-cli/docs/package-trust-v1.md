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

## Production enforcement

Aurora Package Trust v1 requires package signatures by default.

```text
new PackageTrustPolicy()
    -> requireSignatures=true
```

An unsigned package presented through the default production policy fails with:

```text
PACKAGE_SIGNATURE_REQUIRED
```

A controlled caller may explicitly request legacy compatibility:

```text
new PackageTrustPolicy({
  requireSignatures: false
})
```

This explicit compatibility mode only permits unsigned manifests.

If a signature is present, Aurora always authenticates it against the active trust store.

Invalid, unknown, or revoked signatures can never silently downgrade into unsigned behavior.

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

## Official Aurora publisher

Aurora's official built-in packages are authenticated as:

```text
Publisher: aurora-technologies
Algorithm: ed25519
Key ID: ef17eff013d58423f6f6968dda03c01f9ea151b2b20a6466318228945d753591
Public-key encoding: spki-der-base64url
Public SPKI: MCowBQYDK2VwAyEAlqu_eouLNik7Bd6UgMZl3_i_iHOl0N9tVh0Ac96GWFw
```

Only public verification material is stored in Aurora production source.

The private signing key remains external to the repository and is supplied only to the maintainer signing workflow.

## Stage 1B implementation status

Stage 1B establishes:

- the official Aurora Ed25519 publisher identity;
- an offline maintainer signing tool;
- signed auth, database, and env built-in manifests;
- official Aurora public-key trust in the default package policy;
- signature-required production defaults;
- fail-closed handling for unsigned, invalid, unknown, and revoked signatures;
- trusted overlap for signing-key rotation;
- distinct revoked-key handling using PACKAGE_SIGNING_KEY_REVOKED;
- documented signing-key custody, rotation, revocation, recovery, and compromise procedures.

Operational procedures are defined in:

```text
docs/package-signing-operations.md
```

Aurora's restricted package worker remains a Node process isolation boundary and is not an operating-system sandbox.
