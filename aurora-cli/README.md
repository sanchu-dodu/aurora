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
