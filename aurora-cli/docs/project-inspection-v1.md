# Project Inspection v1

The shared read-only project model is the first platform-foundation increment.
It describes existing project state; it is not a new desired-state manifest or a
complete solution-pack/deployment SDK.

## Commands

```sh
aurora project inspect --project ./my-project
aurora project inspect --project ./my-project --json
aurora doctor --project ./my-project --json
aurora doctor --project ./my-project --strict
```

The root defaults to the current directory. Neither command searches parents.
Both run without activating Aurora packages, plugins, or the runtime. Neither
command writes project files, installs dependencies, invokes project scripts,
repairs state, or recovers transactions. Doctor probes Git, Node.js, and the
selected package manager with bounded `--version` commands, from a private
temporary directory outside the inspected project. The directory is removed
after probing. If the system temporary directory lies inside the project root,
probes are skipped and isolation is reported as a failure. Corepack network access, auto-pinning, and project-spec
selection and Corepack env-file loading are disabled for these probes; Yarn path
redirection is disabled. See the [Corepack environment documentation](https://github.com/nodejs/corepack#environment-variables).
Doctor skips relative PATH entries and executable or Windows shim entrypoints
that resolve inside the inspected project, including symlink/junction redirects.
Other executables found on PATH are still trusted local tools; this is not a
sandbox for arbitrary tools or their external dependencies.

## Shared API

```js
import { inspectProject } from "@kin666/aurora-cli/projects";

const report = inspectProject("/absolute/path/to/project");
if (!report.healthy) {
  // Display report.diagnostics; decide on repair separately.
}
```

The API is synchronous, returns detached data, and prints nothing. TypeScript
declarations expose `ProjectInspection` and `ProjectDiagnostic`.

The versioned report contains:

- Canonical root, project kind, project identity, and selected package manager.
- Sorted dependency names by category and script names (not script bodies or
  dependency URLs).
- Installed feature IDs, package receipt identities, and locked versions/sources.
- Optional solution/template identity and recorded capability versions/file digests.
- Capability file comparisons in `capabilityChecks`, without changing those files.
- Metadata diagnostics with stable IDs, pass/warn/fail/skip status, and optional
  suggested next steps.
- Count of uncommitted lifecycle journal envelopes, or null when inspection fails.
- `pendingOperationPlans`: count of unfinished file-plan journals, or null when
  their bounded metadata cannot be safely inspected.

It validates existing `aurora.config.json`, `package.json`,
`.aurora/config.json`, `.aurora/features.json`,
`.aurora/solution.json`, `.aurora/package-state.json`, and `aurora.lock`. Missing optional files are
reported explicitly. Corrupt, duplicate-key, oversized, linked, unsafe, or
unreadable metadata fails closed without echoing raw parser errors. JSON metadata
is bounded to 1 MiB per file. Receipt/lock comparison includes official-lock
binding, publisher, and artifact identity where applicable.

Package-manager selection is project manifest, then package.json's
`packageManager`, then Aurora defaults/config. Conflicting project/package.json
declarations fail. Other managers' dependency lockfiles produce a warning.
Dependency lockfile contents are not validated.

Doctor additionally checks the running Node.js version against the CLI's
`engines.node` and supported project engine ranges. Ranges outside Aurora's
existing range grammar produce a warning, never a compatibility pass. Package
manager probes check availability, not exact pinned-version compatibility.

## Exit codes and automation

Inspection exits 1 for failed metadata checks. Doctor exits 1 for failures, or for
warnings with `--strict`. Warnings alone normally exit 0. A valid root with
diagnostic failures still produces a complete JSON report on stdout under
`--json`, plus a stable error code on stderr. Invalid roots and argument errors
fail before a report can be constructed. `--quiet` suppresses stdout, including
JSON, while retaining failure diagnostics.

## Deliberate limits

These are observations of local state, not security attestations. Recorded
capability files are rehashed within the solution inspector's 1 MiB per-file and
64 MiB source-read bounds. Modified files warn; missing, unsafe, or not-checked
files fail. Package installation inventories are not rehashed here. These checks
do not authenticate the registry, inspect the cache, test service
connectivity, validate secret references, or certify production readiness. Use
the existing package verification and installation trust pipeline for that work.

Lifecycle inspection validates up to 128 immediate journal entries, including
envelope checksums and project-root binding. It does not read recovery
before-images, validate their blobs, inspect older `.aurora/transactions` files,
or execute recovery. An uncommitted journal may describe an active operation:
finish that operation before considering recovery. Recovered history is not
traversed. The report is not an atomic snapshot across files and must not be used
as authorization for a later mutation.

File-plan inspection separately validates up to 128 immediate
`.aurora/operation-journal` entries, including their embedded plan bindings.
Pending or unsafe records produce a failed `project.operation-plans` diagnostic;
committed records do not. It does not read before-image blobs, recover files,
inspect archived history, or activate project code. An active plan can appear
pending while it holds the shared lock. Wait for that process to finish before
considering explicit [file-plan recovery](operation-plan-v1.md#recover-an-interrupted-file-plan).

The [bundled solution/capability increment](solution-packs-v1.md) now uses this model
to create a web-app starter and preview a health endpoint. Recorded capability
digests now support a bounded, read-only change check. The separate
`aurora capability verify` command requires all recorded files to match, including
for its success exit code. Upgrade/migration previews, environment adapters, and
deployment health checks remain future increments.
