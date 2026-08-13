# Package Manifest v1

Every Aurora package is a directory whose name matches the package's canonical `id` and which contains a `manifest.json`. Aurora validates this file before resolving dependencies, loading code, or writing to a project.

Manifest v1 is fail-closed: unknown fields, invalid identifiers, unsupported version syntax, undeclared artifact files, digest mismatches, and incompatible or revoked packages are rejected.

## Minimal manifest

```json
{
  "manifestVersion": 1,
  "kind": "package",
  "id": "example",
  "name": "Example",
  "version": "1.0.0",
  "description": "An example Aurora package.",
  "category": "example",
  "tags": ["example"],
  "frameworks": ["agnostic"],
  "compatibility": {
    "aurora": ">=0.1.0 <1.0.0",
    "node": ">=22.0.0"
  },
  "publisher": {
    "id": "example-publisher",
    "name": "Example Publisher",
    "url": "https://example.com"
  },
  "artifact": {
    "algorithm": "sha256",
    "digest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "provenance": {
    "type": "source",
    "url": "https://example.com/source",
    "reference": "example@1.0.0"
  },
  "dependencies": [],
  "conflicts": [],
  "capabilities": [],
  "files": [],
  "migrations": [],
  "environment": [],
  "platforms": {
    "os": ["any"],
    "architecture": ["any"]
  },
  "lifecycle": {
    "deprecated": false,
    "revoked": false
  },
  "links": {}
}
```

## Identity and versions

- `id`, dependency IDs, conflict IDs, publisher IDs, categories, tags, and framework IDs use lowercase letters, numbers, dots, and hyphens. They cannot contain path separators or traversal segments.
- `version` and migration targets use canonical semantic versions such as `1.2.3` or `1.2.3-beta.1`.
- Compatibility, dependency, conflict, and migration ranges support exact versions and the `>`, `>=`, `<`, `<=`, `^`, and `~` comparators.
- Multiple comparators form an AND range and must have one space between them. Manifest v1 does not support `||`, wildcards, or non-canonical whitespace.
- Prerelease versions satisfy a range only when a comparator explicitly references a prerelease with the same major, minor, and patch version.

## Artifact integrity

Every regular file below the package directory, except `manifest.json`, must appear exactly once in `files`. Symbolic links and junctions are rejected.

Each file entry contains:

- `path`: a canonical relative POSIX path without backslashes or traversal.
- `role`: `installer`, `hook`, `template`, `migration`, or `asset`.
- `digest`: the lowercase SHA-256 digest of the file bytes.

The aggregate `artifact.digest` is calculated by sorting file entries by `path`, converting each entry to `path + NUL + digest`, joining entries with a line feed, and hashing that UTF-8 inventory with SHA-256. An empty inventory uses the SHA-256 digest of an empty string.

Aurora loads the exact files declared by the manifest:

- An installer must be a `.js` file that exports `install(context)`.
- A hook must be a `.js` file below `hooks/` and may export `beforeInstall(context)` and `afterInstall(context)`.
- A template must be below `templates/` and end in `.template`.
- A migration must be a `.js` file below `migrations/` and be referenced by a migration declaration.
- A package can declare at most one installer and one hook file.

## Capabilities

Packages declare every privileged operation they may require:

- `aurora.commands.register`
- `host.environment.read`
- `host.secrets.read`
- `package.code.execute`
- `project.files.read`
- `project.files.write`
- `project.config.write`
- `project.dependencies.write`
- `project.environment.write`
- `process.execute`
- `network.access`

Executable installer, hook, or migration files require `package.code.execute`. Templates require `project.files.write`. Environment declarations require `project.environment.write`.

Capability declarations are currently validated package metadata. Enforcement at each runtime boundary will be added as those extension APIs are introduced.

## Dependencies, conflicts, and lifecycle

Dependencies contain `id`, `version`, and `optional`. Missing optional dependencies are skipped; required dependencies must exist and satisfy the declared range. A package cannot depend on itself, conflict with itself, or list the same package as both a dependency and a conflict.

Platform declarations can use `any` or specific Node.js operating-system and architecture values, but cannot combine `any` with specific values.

Set `lifecycle.deprecated` or `lifecycle.revoked` to `true` only with a non-empty `reason`. Revoked packages cannot be installed. A deprecated or revoked package may name a different canonical package ID as its `replacement`.

Publisher, provenance, and optional link URLs must use HTTPS.
