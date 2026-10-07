# Aurora Operation Plan v1

Aurora Operation Plan v1 is the inspectable contract between deciding what should change and mutating a project. A plan is strict JSON: unknown fields, invalid values, non-canonical paths, duplicate targets, and secret-bearing content are rejected.

## Command flow

Preview a configuration change without mutation:

```bash
aurora config set packageManager pnpm --dry-run --json
```

Export a plan to a new file:

```bash
aurora plan config set packageManager pnpm --out config-plan.json
```

Apply the reviewed plan with explicit approval:

```bash
aurora apply config-plan.json --yes --json
```

Plan files are created without overwriting an existing path. Planning, dry runs, and application do not activate packages or plugins.

## Plan envelope

Every plan contains:

- `schemaVersion`: currently `1`
- `id`: a UUID-backed `plan-...` identifier
- `createdAt` and `expiresAt`: canonical UTC timestamps
- `projectFingerprint`: a SHA-256 binding to the canonical project root
- `intent`: a canonical operation category such as `config.set`
- `summary`: a short human-readable description
- `requiresApproval`: always `true`
- `operations`: one or more ordered typed operations

Plans expire after 15 minutes by default and may never live longer than 24 hours. Application fails if a plan has expired, belongs to another project, contains modified content, or no longer matches the target file state recorded during planning.

## Operation kinds

The v1 schema reserves these typed operation kinds:

- `file.write`
- `file.delete`
- `dependency.change`
- `command.run`
- `policy.check`
- `remote-state.change`

The initial executor enables only `file.write`. Other kinds are parsed so the contract can represent the intended platform model, but application fails closed until an executor and its policy checks are implemented.

A file write records a project-relative canonical path, replacement content and its SHA-256 digest, the expected existing-file state, risk and description metadata, and optional file or directory modes. Multiple file operations cannot target duplicate, ancestor, or descendant paths. Comparisons are case-insensitive to keep exported plans unambiguous across supported operating systems.

Shared ancestor paths must use consistent spelling/casing. Recovery checks exact
recorded child names in created directories, rather than treating a differently
capitalized unrelated file as transaction-owned.

## Approval and dry runs

Mutation requires `--yes`. Omitting approval prints the proposed plan and exits with `OPERATION_APPROVAL_REQUIRED`. A dry run performs all schema, project, expiry, executor, digest, path, and drift checks without writing files and does not require approval.

Immediately before each write, Aurora revalidates the path and expected file state. Enabled file writes share a transaction. If a later operation fails, Aurora restores prior file contents and file or directory permissions and removes files and directories created by the failed transaction where safe.

Mutating apply acquires the existing project lifecycle lock shared with package
operations. Preflight, before-image capture, writes, and rollback all run while
that lock is held. Expiry is checked again after acquisition. A competing apply
cannot capture stale before-images and then remove another Aurora operation's
new files during rollback. Acquisition uses the lock's bounded five-second
timeout; lock or release failures return a stable error, not an applied report.

Under the lock, apply validates at most 128 immediate lifecycle journal entries
(including the recovered-history directory, whose contents are not traversed).
Pending, corrupt, linked, missing, duplicate-key, invalid-UTF-8, or incorrectly
root-bound envelopes block file writes. Committed valid envelopes do not. Apply
does not read before-image blobs or perform package recovery. Plans cannot write
the lifecycle lock, its internal candidate/release/reclaim paths, the journal
tree, or their `.aurora` ancestor. Ordinary configuration and capability records
remain allowed. Approval, project identity, expiry, enabled operation kinds, and
authority-path checks happen before acquiring a lock.

Dry-run remains read-only and does not acquire the lock or create `.aurora`.
Its successful report is not a guarantee that a later apply can acquire the lock
or pass the journal/drift checks. The shared lock serializes cooperating Aurora
writers; it does not isolate the project from a hostile external process.
File plans also persist separate recovery evidence before changing project files.
Complete staged files are published by same-filesystem atomic rename rather than
written in place. Pending or unsafe file-plan evidence blocks ordinary acquisition
of the shared lifecycle lock, including package mutations. It is not passed to
the existing package-recovery engine.

## Recover an interrupted file plan

```sh
aurora recovery plans --project ./my-project --json
aurora recovery plan <transaction-id> --project ./my-project --dry-run --json
aurora recovery plan <transaction-id> --project ./my-project --yes --json
```

Listing and dry-run are read-only, do not acquire a lock, and do not execute
project or package code. Approved recovery takes the shared lifecycle lock and
rolls back only the selected unfinished file plan. It does not resume execution,
recover package journals, or undo a committed plan. Existing `recovery list` and
`recovery rollback <package>` commands keep their legacy package behavior.

Before recovery changes any project file, it validates every recorded target,
directory, and required before-image. A file must match either its recorded
before-state or Aurora's complete intended after-state, including permissions.
An already-restored before-state is left alone. A conflicting edit, unsafe path,
deleted originally-existing file, or unexpected child in a created directory
stops recovery and preserves the record. Capturing a before-image alone does not
give Aurora permission to overwrite a later edit. Each action is revalidated;
interrupted recovery can be retried. Successfully recovered records are archived,
and retrying an archived ID does not inspect or undo newer project changes.

The strict, root-bound, checksummed inventory and immutable plan are stored under
`.aurora/operation-journal/<transaction-id>`. Before-images and staged output stay
inside that private record. A bootstrap candidate outside that namespace is inert:
it never authorizes recovery of project files. Plans cannot write either recovery
namespace or their lock/candidate paths. Corrupt records require deliberate
operator diagnosis, not deletion of evidence or forced overwrite of user edits.

Each journal is bounded to 1 MiB, at most 100 file targets, 1 MiB per file,
64 MiB of before-images, and 1,024 directory records. Inspection accepts at most
128 immediate namespace entries, including the recovered-history directory;
archived history is not recursively inspected. Completed records are retained,
so history retention and long-lived-project administration need a separate
operator workflow before these bounds are reached. Directory mode requests must
retain owner read/write/search permissions; file mode requests must retain owner
read permission so verification and recovery remain possible. Windows does not
provide the same POSIX permission semantics.

This supports recovery after process interruption. It is not an unconditional
power-loss durability promise: directory sync is platform-dependent, including
Windows limitations. Local checksums detect inconsistent evidence; they do not
authenticate a publisher or protect against an attacker rewriting all local
metadata. Cooperative Aurora writers are serialized; a hostile external writer
racing the final filesystem action is not isolated by this lock.

## Operation Report v1

Successful application and dry-run validation return a strict Operation Report v1. With `--json`, the report is printed as machine-readable JSON containing:

- `schemaVersion`: currently `1`
- `reportId`: a UUID-backed `report-...` identifier
- the source `planId`, `intent`, and `projectFingerprint`
- `status`: `applied` or `dry-run`
- canonical `startedAt` and `completedAt` timestamps
- an ordered outcome for every operation
- consistent planned, validated, applied, and failed totals

Report schemas reject unknown fields, inconsistent totals, timestamps that run backward, and per-operation outcomes that do not match the overall status.

## Security limits

- A plan and any planned file target are limited to 1 MiB.
- Paths must be canonical, project-relative, and free of traversal or platform-unsafe segments.
- Symbolic-link and junction escapes are rejected by the project path boundary.
- Plans containing recognized credentials, tokens, cookies, authenticated URLs, or other secret patterns are rejected.
- Exported plan files use private permissions where supported.
- Unsupported operation kinds never execute implicitly.
