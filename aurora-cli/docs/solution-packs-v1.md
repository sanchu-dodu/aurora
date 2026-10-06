# Bundled solution starters and capability previews v1

A solution is a reusable app starter. A capability is an addition to that app.
This increment ships one working starter and one small, real capability. It does
not claim that a complete hosted app or production platform is ready.

## Quick start

```sh
aurora solution list
aurora create web-app my-app
aurora project inspect --project ./my-app
aurora capability list --solution web-app
aurora capability plan health --project ./my-app --out ./health-plan.json --json
aurora apply ./health-plan.json --project ./my-app --dry-run --json
aurora apply ./health-plan.json --project ./my-app --yes --json
aurora capability verify --project ./my-app --json
```

Then open `my-app`, run the selected package manager's install command, and run
`npm run dev` (or the equivalent for that manager). `npm run build` and
`npm run start` create and serve the production build. `/api/health` returns
`{"status":"ok"}` with HTTP 200 while the app is running. This is a **liveness**
check, not proof that a database, external service, or business workflow is healthy.

Creation writes a new directory only. It does not fetch templates, install
dependencies, initialize Git, upload files, deploy anything, or run project code.
The default manager is npm; pnpm and yarn are supported. Project names must be
lowercase, portable, unscoped Node package names. An existing directory is never
reused. Failure cleanup checks that the directory is still the one creation owns;
a replacement directory is preserved and cleanup failure is reported.

The Next.js starter includes the required root layout and exact direct dependency
versions. Users must still install dependencies, review/commit their manager
lockfile, update security patches, and configure their real application. Direct
pins alone do not pin all transitive dependencies. This increment's real build
proof uses npm; pnpm and yarn creation are supported but their installation/build
paths have not been certified by that proof.

## Shared API

```js
import { createSolution, planCapability, listSolutionPacks, inspectCapabilities }
  from "@kin666/aurora-cli/solutions";
import { OperationPlanService }
  from "@kin666/aurora-cli/dist/operations/operationPlanService.js";

const created = await createSolution("web-app", "my-app", {
  workspaceRoot: "/existing/workspace",
});
const plan = await planCapability("health", { projectRoot: created.root });
const service = new OperationPlanService();
await service.apply(plan, created.root, { approved: false, dryRun: true });
// Inspect the plan and obtain approval before calling apply with approved:true.
const files = inspectCapabilities(created.root); // Silent, synchronous, read-only.
```

These APIs print nothing. Descriptors are detached copies. Bundled `web-app` v1.0.0
binds the Next.js template v1.1.0. Local metadata cannot select arbitrary template
directories or executable code. External solution packs are not enabled by this
API; future distribution must use Aurora's existing authenticated registry and
verified package pipeline rather than bypass it.

## Project state and safeguards

`.aurora/solution.json` is strict, duplicate-key-rejecting metadata containing:

- Schema version, solution ID/version, and template ID/version.
- Added capability IDs/versions and generated source paths with SHA-256 digests.

Inventory is bounded to 64 capabilities, 128 files per capability, 512 files total,
and the shared 1 MiB metadata-read limit. Capability IDs and paths cannot repeat
or overlap. Source paths cannot escape the root or claim `.git`/`.aurora` metadata.
Inspection exposes `solution`, validates its metadata, and compares the recorded
capability files. Recorded digests are local tracking data, **not** signatures or
trusted-file attestations. Editing both a file and its local record is not detected
as tampering with an authenticated publisher artifact.

## Checking managed feature files

`aurora capability verify --project ./my-app --json` and the shared
`inspectCapabilities(root)` API compare raw file bytes with recorded SHA-256
digests. They never execute project code, repair files, or update recorded hashes.
Files are classified as `unchanged`, `modified`, `missing`, `unsafe`, or
`not-checked`. Reads reject links, non-regular files, oversized files, and detected
changes during inspection. The limit is 1 MiB per file and 64 MiB of managed-source
reads per inspection, including reads later rejected as unsafe. Metadata reads
have their separate 1 MiB limit. File identities and change timestamps use exact
integer comparisons, including large Windows file identifiers. A file that would
exceed the remaining source-read budget is not opened; it and subsequent files
are reported as not checked.

`healthy` is false for missing, unsafe, uninspected, or invalid recorded state.
A modified file is a warning: a user's edit does not prove the app is broken.
`clean` is true only with valid metadata and all recorded file digests matching.
A valid starter without capabilities checks zero source files and reports that
explicitly. Unsupported local versions do not gain a compatibility or trust claim
from a matching hash.

The dedicated verify command exits 1 whenever the report is not clean, including
user edits. Under `--json`, it still emits the report before the stable error on
stderr. `--quiet` suppresses normal output. Project inspection includes these
comparisons in `capabilityChecks`; doctor warns for user edits (fails with
`--strict`) and fails for missing or unsafe files. These are bounded, non-atomic
observations, not approval for a later overwrite or a full project-tree audit.

Health planning requires a healthy supported solution project and no uncommitted
lifecycle journal. It refuses an existing `app/api/health` directory, including
an empty directory or user code that happens to match generated bytes. Unknown
capabilities and unsupported starter versions fail without changes. Reinstallation
and upgrades are deliberately not enabled.

The preview uses the existing Operation Plan v1 executor. It contains exactly two
writes: the new route and the updated solution record. It is tied to the canonical
project root, expires after 15 minutes, requires explicit approval, and records
the exact current solution-file digest and absent route. Changes to either target
after planning block all writes. The metadata snapshot used to generate the plan
is checked against the planner's own snapshot to prevent a stale receipt update.
Dry-run does not write or acquire a lock. Mutating apply uses the project lifecycle
lock shared with package operations, covering preflight through rollback; expiry
and pending/invalid package recovery records are checked under the lock.
Ordinary apply failures roll back the unfinished file-write transaction where
safe. Persisted recovery evidence also supports explicit rollback after process
interruption through `aurora recovery plans` and `aurora recovery plan`.
Recovery preserves conflicting user edits; it does not resume a plan or undo a
committed plan. This is not an unconditional power-loss guarantee. See
[Operation Plan v1](operation-plan-v1.md) for commands, lock, and journal limits.

Save preview files outside the app (as in the quick start). Writing the preview is
the command's only write; it refuses to overwrite an existing preview file.
`--project` on apply must identify the same root as the plan. Commands use no
plugin/runtime activation; `--json` emits machine-readable output and `--quiet`
suppresses normal output.

The public batch file-write builder supports the same expiry, path, size,
secret-value, collision, and rollback rules as single-file plans. Reads reject
symbolic/hard links, non-regular files, oversized input, and detected changes.

## What remains

This is a narrow proof of the framework, not a generic feature marketplace.
Authentication, roles, payments, storage, search, jobs, richer monitoring,
dependency-changing plans, removals, upgrades/migrations, recovery-history
administration, remote packs, environment/deployment adapters, and an AI planning
layer remain future work. Existing legacy feature commands are separate from this
preview-first capability path.

Plans bind the two affected files, not the whole project tree. Concurrent changes
to other files are not detected; framework compatibility is checked at planning
time. Like the existing executor, path-based rollback and writes do not provide
isolation against a hostile local process changing paths mid-apply. Cooperating
package operations and file-plan applies share a lock; unrelated tools and legacy
operations are not necessarily covered. Real product use, wider platform/tool
validation, release review, security testing, and operational setup are still
needed before calling Aurora production-ready.
