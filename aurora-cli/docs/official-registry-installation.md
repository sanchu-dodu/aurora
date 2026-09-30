# Installing from a pinned official registry

## Command and prerequisites

Run inside an existing Aurora project containing `package.json`:

```text
aurora package install-official <package> --registry-digest <trusted-sha256>
aurora package install-official <package> --registry-digest <trusted-sha256> --version 1.0.0
aurora package install-official <package> --registry-digest <trusted-sha256> --range "^1.0.0"
aurora package install-official <package> --registry-digest <trusted-sha256> --offline
```

First explicitly activate a signed release using `package activate-release`. This command does not discover, download, repair, or activate registry releases. The required lowercase SHA-256 pin must come from independently trusted release evidence, not from the same mutable local registry being checked. Even a legitimate successor requires an explicit pin update. Signature and publisher verification remain mandatory; there is no unsigned/local fallback or trust-bypass flag.

The existing `package install` command remains unchanged. `install-official` is a separate mutation, not a change to legacy package selection.

## Selection and locks

For a package without an existing lock, the default selects the greatest active version in the pinned registry. `--version` and `--range` are mutually exclusive. Required dependencies use their signed manifest ranges; traversal is deterministic by package identifier. A shared dependency must satisfy every encountered constraint. This implementation rejects conflicts rather than performing backtracking or silently changing an earlier selection.

Existing full official locks always take precedence, must satisfy any explicit selector, and must match the exact registry, manifest, archive, provenance, publisher, and package-artifact identity. Legacy version-only locks are refused. Existing locks are not silently migrated to a newer registry generation. A separate reviewed lock-update workflow is outside this command's scope.

Optional dependencies are included only if they already have an entry in `aurora.lock`; absent optional dependencies are skipped. Unrelated existing locks are preserved. The complete selected graph is validated before missing entries are published in one atomic lock-file replacement. A changed initial lock is rejected instead of overwritten. Already-installed packages must have matching authenticated locks, ownership receipts, cache versions, and unchanged owned files; an installed-cache entry alone cannot skip these checks. Implicit adoption of an installed local/legacy package is not supported.

## Verification and execution

Every run reauthenticates the active registry and its complete signed history. The same authenticated snapshot feeds resolution, acquisition, cache verification, extraction, and locking. Downloads use the existing constrained HTTPS acquirer: validated public addresses, pinned transport, no redirects, bounded response handling, and streamed archive size/digest verification. Present but corrupted cache entries fail closed; they do not trigger an automatic replacement download.

Archives are cached under `.aurora/official-artifacts`. Extraction and download staging use a private temporary directory. The extractor validates the archive format, safe paths, declared files, manifest digest, and package artifact. Package signatures, compatibility, and execution capabilities are checked before lock publication or package execution.

Limits are 64 selected packages, 512 MiB combined declared compressed archive size, 512 MiB combined extracted payload, and 10,000 extracted files. Each archive also retains the acquirer's 256 MiB limit and 30-second acquisition timeout. These are resource limits, not a promise of a short total runtime for a maximum-sized dependency graph.

Lock preparation takes the project lifecycle lock and recovers incomplete transactions before comparing the previously observed lock. The installer later acquires its own lifecycle lock and independently revalidates the authenticated receipts and persisted lock before execution. Registry rechecks reject changes observed during preparation; they are not an operating-system lock against arbitrary external filesystem writes. Project-file and installed-state mutations use the existing transactional installer and its rollback/recovery machinery.

## Offline behavior

`--offline` requires full existing official locks for the root and every selected dependency, the matching active signed registry, and every archive in the verified cache. It does not accept version selectors, download missing archives, resolve DNS for acquisition, or create a missing cache. Every cached archive is reverified before extraction.

Offline mode also removes package-scoped network grants: packages declaring network access are refused even if a trusted API caller supplies such grants. Package execution retains the existing restricted worker and broker policies. A `config.addDependency` call edits project metadata; this command does not run `npm install` or promise that external npm dependencies are available offline. It is not a whole-machine network firewall, and trusted embedding callbacks remain the caller's responsibility.

To reproduce a package set in another workspace, provide its project files, exact `aurora.lock`, authenticated `.aurora/official-registry` generation, and `.aurora/official-artifacts` cache. Obtain the pin independently and run the offline command. Do not copy installed-state receipts merely to make a fresh workspace appear installed.

## Failure, retry, and boundaries

Before a valid complete graph exists, failure does not publish a partial install lock. A successfully prepared authenticated lock and verified cache entries may remain if a later registry recheck, capability-dependent execution, or installation fails. They are retry/audit artifacts, not proof of a completed installation. Existing project changes are rolled back through the installer; interrupted work is recovered under the lifecycle lock. If recovery changes the lock used to plan the operation, the command refuses that stale plan and should be rerun after inspection.

Private staging is removed on successful and failed runs only while its checked directory identity remains unchanged. If staging identity changes, cleanup refuses to delete the replacement. A primary failure is preserved when cleanup also fails; inspect the private temporary directory if manual recovery is necessary. Cleanup failure after a successful installation is reported as a cleanup error, not as a rolled-back install.

There is no automatic lock upgrade, dependency backtracking, public marketplace, registry freshness service, revocation delivery, release upload, private-key access, or package-manager dependency installation in this command. A valid offline snapshot cannot reveal later releases or revocations. Independently trusted checkpoints and distribution operations remain separate milestones.
