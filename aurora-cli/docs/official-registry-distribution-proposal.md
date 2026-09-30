# Official Registry Distribution: Architecture Proposal

**Status:** Proposal only; not an implemented protocol or production service.

## Problem

Aurora can build local publication bundles, authenticate signed registry history, finalize releases, activate a verified release, and install packages from a digest-pinned active registry. It does not currently discover or download registry releases. A valid signature authenticates the history supplied to the client; by itself it does not prove that history is current. A server that continually serves an older valid generation can hide newer releases and revocations.

The next milestone must supply a trusted update path without weakening the existing package-signature and registry-history checks.

## Recommendation

Use The Update Framework (TUF) for distribution metadata and freshness, while keeping Aurora's signed registry snapshot/history as the authority for Aurora package identities, publisher trust, package lifecycle, and revocation semantics.

The TUF metadata should identify exact, bounded target files by version, byte length, and cryptographic digest. The client should first verify TUF metadata, download only authorized targets, then pass the unchanged registry release and history through Aurora's existing verifier and forward-only activation transaction. TUF must not replace or bypass either verifier.

The official TUF model separates Root, Targets, Snapshot, and Timestamp roles. That separation is a better starting point for key compromise and freshness handling than adding an ad-hoc unsigned `latest.json` pointer or treating HTTPS as proof of recency. See the [TUF metadata roles](https://theupdateframework.io/docs/metadata/), [TUF security analysis](https://theupdateframework.io/docs/security/), and [TUF specification](https://theupdateframework.io/spec/).

## Proposed trust and update flow

1. **Bootstrap:** A supported Aurora CLI release carries the initial trusted Root metadata or a securely pinned Root key. The release itself must have a separately verifiable provenance and release process. Trust must not be bootstrapped by downloading a key from the same unauthenticated/mutable endpoint as the registry data.
2. **Refresh metadata:** The client verifies Root updates sequentially and then validates Timestamp, Snapshot, and Targets signatures, versions, hashes, sizes, and expiry according to the selected TUF specification and client implementation.
3. **Select targets:** Verified Targets metadata names a registry release bundle and artifact objects. The client enforces strict size limits and a fixed, configured origin policy. Redirects and cross-origin transfers are rejected unless an explicit, reviewed transport policy pins each permitted destination.
4. **Verify Aurora history:** The client verifies the complete signed registry history using Aurora's existing verifier. The candidate must advance from the locally active generation; forks, stale generations, missing predecessors, and revoked packages fail closed.
5. **Commit atomically:** Only after all metadata, target bytes, signatures, and history checks pass may the existing activation transaction select the new generation. Failed refresh or activation leaves the active pointer unchanged.
6. **Install:** Online installs refresh the trusted distribution metadata before resolving packages. Explicit offline installation uses the existing exact-lock/cache contract and reports that it cannot learn of newer releases or revocations while disconnected.

## Key and state boundaries

- TUF Root authority, online freshness-signing authority, Aurora registry-signing authority, and package-publisher keys are distinct roles. Compromise of one should not silently confer the others' powers.
- Root signing material should be offline and recoverable through a documented threshold/rotation process. Timestamp signing may be online only with narrowly scoped authority and short metadata expiry. Exact thresholds, owners, backup locations, and expiry periods are operational decisions still to make.
- The existing Aurora signing-operations document remains authoritative for package/registry signing. This proposal does not authorize generating or moving production keys.
- Persisted trusted metadata needs atomic update, lifecycle/concurrency protection, and bounded storage. Its threat model must state whether local rollback of the entire client state is in scope; local storage alone cannot provide an independent checkpoint against an attacker who can restore all local state.
- Expiration bounds some freeze scenarios only when the client has a trustworthy clock. Clock rollback, first-install bootstrap, metadata-server denial of service, and old signed CLI binaries need explicit treatment and user-visible failures.

## Distribution transport candidate

The repository has an existing GitHub Release precedent, but currently no registry metadata feed or registry assets. GitHub Releases could be a low-operations pilot transport for public immutable-by-digest targets, with the client treating the host as an untrusted byte source and relying on verified metadata for authenticity. It is not yet selected as the production origin. In particular, asset-download redirects, CDN host allowlists, repository/release mutability, availability, and long-term retention must be tested before using it.

A dedicated object store/CDN is an alternative if the project needs a stable API, retention guarantees, or independent service ownership. It has the same metadata-verification requirements and adds hosting, access-control, monitoring, backup, and incident-response work.

## Failure and offline policy

- Invalid, expired, rolled-back, fast-forwarded, inconsistent, oversized, or incorrectly signed metadata fails closed before package selection.
- Missing, altered, or digest-mismatched targets fail closed; no alternate registry, unsigned source, or unverified mirror is selected automatically.
- A network outage must not be reported as a successful freshness check. Online installation should stop with a clear error unless a separately reviewed policy explicitly permits use of a still-valid cached metadata chain.
- Offline mode remains explicit and lock-based. It may reproduce a previously trusted package set, but it must disclose that no new revocations were obtained.
- A refresh must not silently repair or reset corrupted active state. Recovery remains an operator-reviewed operation.

## Acceptance tests for an implementation

- Fresh-client bootstrap from the packaged root and verification of a valid release.
- Sequential root rotation, threshold signatures, role separation, and recovery from expired root metadata.
- Rollback, freeze, fast-forward, expired metadata, inconsistent metadata, revoked keys, and compromised online-role simulations.
- Correct digest/size checks; path traversal and oversized-target rejection; interrupted downloads; redirects; DNS changes; and disallowed hosts.
- No active-pointer mutation for any failure before the final atomic activation.
- Concurrent refresh/activation and crash recovery on supported Windows and Linux versions.
- Online revocation refresh and explicit offline behavior using exact locks and cached artifacts.
- A clean packaged CLI installation that can bootstrap without credentials or private signing material.

## Not done by this proposal

No distribution host was provisioned, no registry feed or release asset was published, no TUF metadata or keys were generated, no third-party client library was selected, and no production service was deployed. Those require a reviewed implementation, key-ownership and hosting decisions, and an operational runbook before launch.
