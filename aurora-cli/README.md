# Aurora CLI

Aurora CLI is a command-line toolkit for creating, extending, validating, and managing Aurora projects.

## Requirements

- Node.js 22.15 or newer
- npm
- Git is recommended

## Installation

```bash
npm install --global @kin666/aurora-cli
```

Verify the installation:

```bash
aurora --version
aurora --help
```

## Create a project

Search available templates:

```bash
aurora template search next
```

Inspect the Next.js template:

```bash
aurora template info nextjs
```

Create a new project:

```bash
aurora template install nextjs my-aurora-project
```

## Main commands

```bash
aurora doctor
aurora plugin list
aurora config list
aurora generate list
aurora feature list
aurora package list
```

All commands accept `--quiet` (or `-q`) to suppress normal standard output and `--no-color` to remove ANSI color and terminal styling. Quiet mode does not suppress failure diagnostics written to standard error.

## Plan before mutation

Aurora configuration writes use a strict Operation Plan v1 contract. Preview a change without writing anything:

```bash
aurora config set packageManager pnpm --dry-run --json
```

Export a project-bound plan for review, then apply that exact plan with explicit approval:

```bash
aurora plan config set packageManager pnpm --out config-plan.json
aurora apply config-plan.json --yes --json
```

Plans expire, reject secret values, and fail if the project or target file changes after planning. Applying or validating a plan returns a versioned Operation Report v1 with stable plan and report identifiers, per-operation outcomes, timestamps, and totals.

See [Operation Plan v1](docs/operation-plan-v1.md) for the schemas, enabled operations, validation rules, and security limits.

Direct configuration mutation also requires explicit approval:

```bash
aurora config set packageManager pnpm --yes
```

## Shell completion

Aurora can generate completion setup without starting the runtime or loading packages and plugins:

```bash
aurora completion bash
aurora completion zsh
aurora completion fish
aurora completion powershell
```

Evaluate or save the generated script using the normal setup for your shell. Help, version, completion, and rejected command lines are parsed before Aurora activates runtime services.

## Error reporting

Aurora uses stable error codes for recognized command failures.

Example:

```text
Aurora CLI failed:
Code: TEMPLATE_NOT_FOUND
Message: Template 'missing' not found.
Suggestion: Run 'aurora template search <query>' to discover available templates.
```

Failed commands return a non-zero process exit code so scripts and CI systems can detect failures.

## Package manifests

Aurora packages use a strict, versioned trust contract. Before installation, Aurora validates package identity, semantic-version compatibility, publisher and provenance metadata, dependencies and conflicts, requested capabilities, declared files and migrations, platform support, lifecycle state, and SHA-256 artifact integrity.

See [Package Manifest v1](docs/package-manifest-v1.md) for the complete format, capability list, and digest algorithm.

## Verified publication bundles

`aurora package publish <package>` prepares a local publication bundle under `.aurora/publications`. Use `--dry-run` to authenticate, verify, and preview the content-addressed archive identity without writing files. Aurora authenticates the package publisher, verifies the strict manifest and complete declared file inventory, and then creates a deterministic POSIX ustar archive inside a normalized gzip envelope.

Every bundle is stored by its SHA-256 archive digest and contains only:

- `package.tar.gz`, with the exact authenticated manifest and declared package files
- `publication.json`, a canonical receipt binding package, version, publisher, signature key, manifest digest, artifact digest, provenance, archive size, and archive digest

An identical command reuses only an exact existing bundle. Aurora refuses to overwrite mismatched content at a content-addressed path. This command does not upload an artifact, mutate the official registry, or access a private signing key; those remain separate release-authority steps.

## Verified registry release proposals

`aurora package propose-release <package>` bridges a verified publication bundle to Aurora's offline registry-signing process. The command requires `--registry-history <file>`, `--archive-url <url>`, and `--published-at <timestamp>`. The history file is a JSON array containing every signed official snapshot from genesis through the current registry state.

Aurora re-verifies the complete signed history, rebuilds and authenticates the package publication, requires a canonical content-addressed HTTPS URL ending in `/<archive-digest>/package.tar.gz`, and refuses an existing or non-forward package version. The proposed snapshot advances the registry sequence exactly once, preserves every prior entry, binds the verified predecessor digest, and keeps package entries in canonical order.

Use `--dry-run` to preview the exact sequence and signing-payload digest without writing files. A committed proposal is stored under `.aurora/registry-proposals` and contains:

- `proposal.json`, the canonical proposal, unsigned snapshot, publication evidence, predecessor identity, and signing-payload digest
- `registry-signing-payload.bin`, the exact domain-separated bytes for an offline Ed25519 signing authority

The command never reads a private key, creates a signature, uploads an artifact, or mutates the live registry. After an authorized offline signer supplies `signature.value`, the normal official-registry verifier must authenticate the signed successor against its verified predecessor before distribution.

## Verified registry release finalization

`aurora package finalize-release <proposal>` completes the offline half of the registry release ceremony without bringing the registry private key into Aurora. The command requires `--registry-history <file>` and `--signature <file>`. The signature file must contain exactly one canonical unpadded base64url Ed25519 signature followed by one LF.

Aurora re-verifies the complete current history, requires the proposal directory to contain only its canonical `proposal.json` and exact `registry-signing-payload.bin`, reconstructs the unsigned snapshot, and verifies that the proposal still advances from the current authenticated predecessor. It then imports the signature, runs the normal official-registry verifier over the signed successor, and refuses stale proposals, altered payloads, wrong-key signatures, unexpected fields, and noncanonical encodings.

Use `--dry-run` to authenticate the complete result without writing it. A committed release is stored immutably under `.aurora/registry-releases/<sequence>/<verified-snapshot-digest>/snapshot.json`; an identical rerun reuses only the exact existing bytes. Finalization never signs, reads a private key, uploads an artifact, overwrites registry history, or changes a live registry pointer. Distribution and activation remain separate authorized operations.

## Verified registry release activation

`aurora package activate-release <release>` is the separate, explicit operation that imports a finalized signed snapshot into the live local official registry. It requires `--registry-history <file>` containing every authenticated predecessor from genesis through the currently trusted snapshot. The release directory must contain exactly the canonical `snapshot.json` produced by finalization.

Aurora verifies the complete chain and successor again, creates a portable canonical history, and stores an immutable generation under `.aurora/official-registry/generations/<sequence>/<snapshot-digest>`. Each generation contains only the signed snapshot, the complete authenticated history, and a canonical activation receipt binding both digests. After those files are durable, Aurora atomically changes `.aurora/official-registry/current.json` under the project lifecycle lock.

Use `--dry-run` to authenticate the candidate without creating `.aurora` or changing live state. Activation is idempotent for the exact active generation and fails closed on rollback, forks, skipped sequences, split histories, unexpected release files, noncanonical bytes, altered generations, forged pointers, or concurrent state drift. It does not download packages, upload registry data, sign releases, access private keys, delete earlier generations, or edit the supplied history file. See [Verified official registry activation](docs/official-registry-activation.md) for the storage and recovery contract.

## Extension worker prototype

The bundled Hello extension runs outside the main Aurora process through the Extension Worker v1 prototype. Aurora validates a strict manifest, scrubs inherited environment data, brokers declared capabilities, and enforces time, memory, output, and per-extension concurrency limits.

The prototype currently allows only brokered output by default. Direct filesystem, network, subprocess, worker-thread, native-addon, WASI, external-package, and out-of-root import access fail closed. This boundary currently covers the bundled sample extension; package installers, hooks, migrations, and arbitrary third-party plugins have not yet been migrated.

See [Extension Worker v1](docs/extension-worker-v1.md) for the contract, trust model, limits, supported capabilities, and current non-goals.

## Development

Install dependencies:

```bash
npm ci
```

Run the build and tests:

```bash
npm test
```

Run complete release validation:

```bash
npm run release:check
```

## Package contents

The published npm package contains:

- compiled CLI files under `dist`
- Aurora packages under `packages`
- project and generator templates under `templates`
- package-author documentation under `docs`
- publication documentation

Development source code and tests are excluded from the published package.

## Status

Aurora CLI is currently in early development at version 0.1.0. Commands and APIs may change before version 1.0.0.

## License

Aurora CLI is licensed under the MIT License. See `LICENSE`.
