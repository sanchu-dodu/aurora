# Verified active official registry resolution

## Purpose

Activation selects one authenticated registry generation, but files on disk are not trusted merely because activation wrote them earlier. Every consumer must reauthenticate the selected generation at the time of use. Aurora's active registry reader provides that boundary, and `aurora package resolve` is its first command-line consumer.

The command is:

```text
aurora package resolve <package> [--version <version> | --range <range>] \
  [--registry-digest <trusted-snapshot-digest>]
```

With no selector, Aurora returns the greatest active version in the authenticated registry order. `--version` requests one exact semantic version. `--range` returns the greatest active version satisfying the supplied semantic-version range. Versions revoked in the selected snapshot are never returned.

## Authentication procedure

The reader begins at `.aurora/official-registry/current.json` and treats every local byte as attacker-controlled. It:

1. requires the registry root and selected generation to be real directories with exact file sets;
2. reads bounded regular files while checking file identity and metadata for replacement during the read;
3. requires `current.json`, `activation.json`, `history.json`, and `snapshot.json` to use their exact canonical JSON encodings;
4. requires the active pointer and generation receipt to be byte-for-byte identical;
5. checks the complete-history and predecessor-history SHA-256 digests named by the receipt;
6. requires `snapshot.json` to be the final snapshot in the complete history;
7. constructs `OfficialRegistryVerifier` internally and replays every signed snapshot from genesis;
8. binds the verified current digest, sequence, predecessor digest, and history length back to the activation receipt;
9. compares the authenticated snapshot digest with the optional trusted pin; and
10. rechecks the active pointer before returning, rejecting a change observed during verification.

Only the resulting authenticated object may cross the active-reader boundary. Its authenticity marker is held privately and cannot be recreated by structurally copying its fields.

## Failure behavior

Resolution fails closed when active state is missing or when any pointer, receipt, selected-generation file, signature, trust root, digest link, sequence, package transition, or canonical encoding is invalid. Aurora does not select a different generation as a fallback and does not attempt an automatic rollback.

Earlier inactive generations remain audit evidence. Corruption in an inactive directory does not change the selected generation's meaning because the selected generation carries and reauthenticates its own complete signed history.

## Freshness and replay boundary

Signatures authenticate the supplied history; they do not prove it is the newest history. The normal activation command advances from its current local state, but an attacker who can restore an older valid pointer and generation outside that command can replay a previously signed snapshot. An unpinned read accepts that internally valid snapshot. It cannot know about a newer release or revocation that is absent from the supplied history.

For workflows that know the required registry identity, supply `--registry-digest` with its lowercase SHA-256 digest. API consumers use `expectedSnapshotDigest`. The pin must come from independently trusted policy or release evidence; copying it from the same mutable local store provides no independent protection. A pin requires the exact snapshot, so even a legitimate successor requires an explicit pin update. The pin never replaces signature verification or grants trust to a signing key.

The reader remains read-only and performs no network freshness check. A persistent trusted checkpoint, authenticated update discovery, and remote revocation delivery remain separate work. The final pointer recheck detects observed drift; it does not lock the filesystem or guarantee that state remains unchanged after the call returns.

## Read-only boundary

The reader and resolver do not:

- create or repair registry state;
- acquire or activate a release;
- contact a registry or artifact host;
- download, cache, extract, install, or execute a package;
- sign data or access a private key; or
- rewrite the active pointer or any immutable generation.

Artifact acquisition and installation remain later, separate operations. They must consume the authenticated resolution identity rather than reopening and trusting registry files independently.
