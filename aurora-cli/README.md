# Aurora CLI

Aurora CLI is a command-line toolkit for creating, extending, validating, and managing Aurora projects.

## Requirements

- Node.js 22 or newer
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
