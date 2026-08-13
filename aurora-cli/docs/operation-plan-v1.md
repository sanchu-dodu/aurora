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

## Approval and dry runs

Mutation requires `--yes`. Omitting approval prints the proposed plan and exits with `OPERATION_APPROVAL_REQUIRED`. A dry run performs all schema, project, expiry, executor, digest, path, and drift checks without writing files and does not require approval.

Immediately before each write, Aurora revalidates the path and expected file state. Enabled file writes share a transaction. If a later operation fails, Aurora restores prior file contents and file or directory permissions and removes files and directories created by the failed transaction where safe.

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
