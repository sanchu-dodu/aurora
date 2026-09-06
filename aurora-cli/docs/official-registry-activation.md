# Verified official registry activation

## Purpose

Release finalization proves that an offline signature authenticates one exact successor snapshot and stores that snapshot immutably. It intentionally cannot make the release live. Activation is the distinct local authority boundary that accepts a distributed finalized snapshot, verifies its complete history, commits an immutable generation, and then selects that generation with one atomic pointer update.

The command is:

```text
aurora package activate-release <release> \
  --registry-history <file>
```

Add `--dry-run` to perform all input and cryptographic verification without writing activation state.

## Inputs

`<release>` must be an in-workspace directory containing exactly `snapshot.json`. The file must be a bounded, regular, non-symbolic-link file whose bytes are the canonical signed registry snapshot produced by `finalize-release`.

`--registry-history` must name a bounded JSON array containing every signed predecessor snapshot in order from genesis to the current registry state. Aurora does not trust the shape of these values. It constructs the normal `OfficialRegistryVerifier` internally and authenticates every signature, digest link, sequence, immutable package identity, lifecycle transition, timestamp, and trust-store key before examining the successor.

The successor must advance the authenticated predecessor by exactly one sequence and name its exact digest. This makes a stale proposal, skipped generation, rollback, or alternative fork invalid before local state can change.

## Durable state

Successful activation writes a content-addressed generation:

```text
.aurora/official-registry/
  current.json
  generations/
    <sequence>/
      <snapshot-digest>/
        activation.json
        history.json
        snapshot.json
```

`snapshot.json` is the exact canonical signed snapshot. `history.json` is the canonical complete chain from genesis through that snapshot. `activation.json` binds:

- the registry sequence and snapshot digest;
- the signed predecessor digest;
- the complete-history digest and length; and
- the predecessor-history digest.

`current.json` is byte-for-byte the receipt for the selected generation. Generation directories are immutable. An identical activation may reuse only an exact generation whose three files have been revalidated.

## Atomicity and concurrency

Activation holds Aurora's cross-process project lifecycle lock. It creates and syncs a complete staging generation, renames that directory into its content-addressed location, rechecks the live pointer for drift, and only then atomically writes `current.json`.

A crash before the pointer update can leave an authenticated but inactive immutable generation. Because a missing pointer in a non-empty store is indistinguishable from pointer deletion, normal activation fails closed and requires explicit operator recovery instead of guessing which generation was live. A crash after the pointer rename exposes a complete generation. Concurrent cooperating activations serialize. The shared durable-directory primitive also tolerates a concurrent creator only when the resulting path is a real directory, never a symbolic link.

## Forward-only rules

When a current pointer already exists, Aurora authenticates its referenced snapshot, history, and receipt against the candidate's verified predecessor. A new candidate must advance from that exact generation. The following states fail closed:

- an older sequence or the current sequence with different content;
- a validly signed alternative fork;
- a successor built from a different authenticated history;
- missing, additional, replaced, symbolic-link, or changed files;
- a noncanonical or forged current pointer;
- tampering with any immutable generation file; or
- live-pointer drift during the activation transaction.

Earlier generations are retained for audit evidence, but the activation command cannot select them again. Recovery from a corrupted local store is an explicit operator repair procedure, not an automatic rollback.

## Non-goals

Activation does not:

- create or import a private signing key;
- sign or modify a registry snapshot;
- upload or download registry data;
- overwrite the supplied predecessor history;
- fetch, extract, install, or execute package artifacts;
- remove an earlier generation; or
- bypass publisher, key, revocation, or append-only verification.

Transport remains replaceable: a finalized release and history may arrive through any channel, because local acceptance depends on their cryptographic identities and canonical bytes rather than transport trust.
