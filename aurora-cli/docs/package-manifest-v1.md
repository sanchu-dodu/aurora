# Package Manifest v1

Every Aurora package is a directory whose name matches the package's canonical `id` and which contains a `manifest.json`. Aurora validates this file before resolving dependencies, loading code, or writing to a project.

Manifest v1 is fail-closed: malformed UTF-8, duplicate decoded JSON properties, unknown fields, invalid identifiers, unsupported version syntax, malformed signature envelopes, undeclared artifact files, digest mismatches, incompatible packages, and revoked packages are rejected.

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


## Package trust and signatures

Manifest v1 supports an optional package signature:

```json
{
  "signature": {
    "version": 1,
    "algorithm": "ed25519",
    "keyId": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "value": "canonical-unpadded-base64url-signature"
  }
}
```

Package Trust v1 uses Ed25519.

`keyId` is the lowercase SHA-256 fingerprint of the canonical Ed25519 SPKI DER public key.

Aurora validates the raw manifest before schema validation. Invalid UTF-8, a UTF-8 BOM, duplicate decoded JSON properties, malformed Unicode, excessive document size, and excessive nesting fail closed.

The signing payload is:

```text
UTF8("AURORA-PACKAGE-MANIFEST-SIGNATURE-V1")
+
NUL
+
UTF8(canonical-json(signing-document))
```

The signing document contains the complete Manifest v1 security metadata and signature metadata, except for `signature.value`.

Aurora uses its own strict deterministic canonical JSON representation. It is not claimed to be RFC 8785/JCS.

During Stage 1A, unsigned packages can remain compatible when the active policy does not require signatures. If a signature is present, however, Aurora always verifies it and an invalid or untrusted signature fails closed.

Package Trust uses these errors:

- `PACKAGE_SIGNATURE_REQUIRED`
- `PACKAGE_SIGNATURE_INVALID`
- `PACKAGE_PUBLISHER_UNTRUSTED`
- `PACKAGE_SIGNING_KEY_REVOKED`

See `docs/package-trust-v1.md` for the complete Package Trust v1 specification.

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

Capability declarations are enforced at Aurora package execution boundaries. Executable package code runs through a restricted Node worker process, while privileged project mutations are brokered by the host and checked against manifest declarations and host policy. Unsupported, undeclared, or host-denied capabilities fail closed. This restricted Node execution boundary is not an operating-system sandbox.

## Project file read declarations

Packages that require read-only project context must explicitly declare every project file they may request.

```json
{
  "capabilities": [
    "project.files.read"
  ],
  "projectFileReads": [
    {
      "path": "package.json",
      "required": true
    }
  ]
}
```

The `projectFileReads` field is optional. Existing manifests that omit it retain field-absence semantics; Aurora does not synthesize `projectFileReads: []`.

Each declaration contains:

- `path`: an exact canonical relative POSIX project path. Absolute paths, backslashes, traversal segments, directory declarations, aliases, and glob patterns are not supported.
- `required`: whether execution requires the declared file to exist.

A manifest may declare at most 50 project-file reads, and declared paths must be unique. A non-empty `projectFileReads` array requires `project.files.read`, and declaring `project.files.read` requires at least one explicitly named project file.

Package Trust cryptographically binds `projectFileReads` because the signing document covers the complete manifest except for `signature.value`. Changing a declared path or its `required` flag invalidates the existing package signature.

### Trusted host admission

Manifest declaration does not grant project-file access by itself. Trusted `PackageExecutionPolicy` must contain a matching `packageProjectFileGrants` entry scoped to the exact authenticated `publisherId`, exact package `packageId`, and explicit path list.

Generic `allowedCapabilities` cannot grant `project.files.read`. An exact project-file grant for one publisher or package does not authorize another publisher or package, and granting one declared path does not authorize another declared path.

Project-file authority does not propagate through dependency relationships. A root package grant does not authorize a dependency processed by the same `PackageWorker`; every package that requires project-file access needs its own exact publisher/package/path grant.

Package manifests, normal package-install CLI inputs, project configuration, and project environment values cannot construct `packageProjectFileGrants`. Project-file authority remains trusted host policy.

### Protected read surfaces

Aurora applies a host-owned intrinsic deny policy even when a path is both declared and granted. Project-file reads cannot access:

- `.git/**`
- `.aurora/**`
- `.env`
- `.env.*`
- `.npmrc`
- `.yarnrc`
- `.yarnrc.yml`
- `.netrc`
- `_netrc`
- `.pypirc`

Protected names are denied case-insensitively and alternate separators are handled defensively by the read policy.

`package.json` and project lockfiles are not intrinsically blocked from read-only access, but they remain unavailable unless the exact path is declared by the package and admitted by trusted host policy.

### Brokered runtime API

After manifest validation and exact host-policy admission, package code may request a declared file only through:

```text
context.project.files.readText(path)
```

`PackageWorker` constructs the host-side project-file broker from the active `InstallerContext` project root for each installation. Reusing a `PackageWorker` with another project therefore creates a new broker bound to the new project root rather than retaining stale project-root authority.

The restricted package worker does not receive direct filesystem permission for the project root. Worker filesystem permission remains limited to the worker runtime root and package directory; project-file contents cross the execution boundary only through the host capability broker.

The host broker applies project-boundary validation, rejects symbolic-link or junction escapes, opens the exact candidate file, verifies that it is a regular file, and revalidates opened-file identity before releasing content.

### File semantics and limits

- A required declaration whose file is absent fails with `PACKAGE_PROJECT_FILE_REQUIRED`.
- An optional declaration whose file is genuinely absent returns `null`.
- Empty files return an empty string.
- Only regular UTF-8 text files are released. Invalid UTF-8 and NUL-containing text fail closed.
- One project file may contain at most 256 KiB.
- One lifecycle execution may receive at most 1 MiB of project-file data in total.
- Every successful non-empty repeated read counts again toward the 1 MiB lifecycle budget.
- Optional `null` results and empty-string results consume zero lifecycle-budget bytes.
- Exceeding either read limit fails with `PACKAGE_READ_LIMIT`.

Project-file contents are not automatically classified as package secrets and are not automatically added to the exact-value secret-redaction set. Packages that require secret material must use explicit `secrets` declarations and `host.secrets.read`.

`project.files.read` does not grant project writes, host environment access, secret access, process execution, or network access. `network.access` and `process.execute` remain unsupported package capabilities.

As with the rest of package execution, this restricted Node worker is not an operating-system sandbox.

## Host environment declarations

Packages that require non-secret host context must explicitly name every host environment variable they may request.

```json
{
  "capabilities": [
    "host.environment.read"
  ],
  "hostEnvironment": [
    {
      "name": "AURORA_REGION",
      "required": true
    }
  ]
}
```

The `hostEnvironment` field is optional. Existing manifests that omit it retain field-absence semantics; Aurora does not synthesize `hostEnvironment: []`.

Each declaration contains:

- `name`: a canonical uppercase environment-style identifier matching `[A-Z][A-Z0-9_]*`, at most 128 characters.
- `required`: whether execution requires a host-provided value to exist.

Names must be unique within the manifest. A non-empty `hostEnvironment` array requires `host.environment.read`, and declaring `host.environment.read` requires at least one explicitly named host environment variable.

Package Trust cryptographically binds `hostEnvironment` because the signing document covers the manifest except for `signature.value`. Changing a variable name or its `required` flag invalidates the existing package signature.

### Trusted host admission

Manifest declaration does not grant host environment access by itself. The trusted package execution policy must contain a matching `packageEnvironmentGrants` entry. Each grant is scoped to an exact authenticated `publisherId`, exact package `packageId`, and explicit variable-name list.

Generic `allowedCapabilities` cannot grant `host.environment.read`, even if a trusted caller places that capability in the broad allow-list.

A grant for one publisher or package does not authorize another publisher or package. Granting one declared variable does not authorize another declared variable.

Environment authority does not propagate through dependency relationships. A root package grant does not authorize a dependency processed by the same `PackageWorker`; every dependency that requires host environment access needs its own exact publisher/package/variable grant.

The normal Aurora CLI, package manifest, project configuration, and project environment cannot create `packageEnvironmentGrants`. This keeps package-controlled input from promoting its own host authority.

### Trusted value provider

Authority and data are separate. `PackageInstaller` can receive an explicit programmatic `environmentProvider`, which `PackageWorker` wraps in `PackageEnvironmentBroker`. Aurora does not create a default host environment provider.

The broker, `PackageWorker`, and `PackageInstaller` do not use the host process `process.env` as the package data source. Declared values are not copied into the worker `process.env`.

After manifest validation and exact host-policy authorization, package code may request an admitted value only through:

```text
context.host.environment.read(name)
```

The restricted worker therefore receives only the value returned for that explicitly authorized request. This capability is not arbitrary host environment access.

### Value semantics and limits

- A required declaration with no available value fails with `PACKAGE_ENVIRONMENT_REQUIRED`.
- An optional declaration with no available value returns `null`.
- An empty string is a valid available value.
- NUL-containing values and non-string provider results fail closed.
- One returned value may contain at most 64 KiB measured as UTF-8 bytes.
- One lifecycle execution may receive at most 256 KiB of host environment data in total.
- Repeated reads count again toward the 256 KiB lifecycle budget.
- Exceeding the lifecycle budget fails with `PACKAGE_READ_LIMIT`.

`hostEnvironment` is a non-secret channel. Secret material must use explicit package secret declarations and `host.secrets.read` instead. Ordinary host environment values are not automatically added to the Phase 3 exact-value secret-redaction set.

`network.access` and `process.execute` remain separate unsupported package capabilities. `host.environment.read` does not imply either capability.

As with the rest of package execution, the restricted Node worker is not an operating-system sandbox.

## Package secret declarations

Packages must explicitly name every host-managed secret they may request.

```json
{
  "capabilities": [
    "host.secrets.read"
  ],
  "secrets": [
    {
      "name": "database-password",
      "required": true
    }
  ]
}
```

The `secrets` field is optional. Existing signed manifests that omit it retain their original validated shape; Aurora does not synthesize `secrets: []`.

Each declaration contains:

- `name`: a canonical lowercase package identifier, at most 128 characters.
- `required`: whether execution requires that package-scoped secret to exist.

Secret names must be unique within the manifest.

A non-empty `secrets` array requires `host.secrets.read`. Declaring `host.secrets.read` without at least one named secret is invalid.

Manifest declaration does not grant access by itself. The active host execution policy must also contain a matching `packageSecretGrants` entry for the authenticated publisher, package, and requested secret. Generic `allowedCapabilities` cannot grant `host.secrets.read`.

Package secret names identify a package-scoped logical namespace. They are not operating-system credential IDs.

Aurora derives the credential-store identifier from publisher ID, package ID, and secret name using a domain-separated SHA-256 mapping.

A package secret named `aurora-cloud` therefore does not resolve to the Aurora Cloud internal credential. It resolves only inside that publisher and package namespace.

Secret values are never stored in the package manifest, package files, project configuration, or package environment declarations.

Package Trust cryptographically binds the `secrets` field because the signing document covers the manifest except for `signature.value`. Changing a secret name or its `required` flag invalidates the existing signature.

The package worker does not have direct operating-system credential-store access. Secret values may cross the execution boundary only through Aurora host-side capability brokering after manifest and host-policy authorization.

A restricted Node worker is not an operating-system sandbox.

### Trusted host policy admission

Declaring `host.secrets.read` and naming a secret in a signed package manifest does not grant secret access by itself. Manifest declarations describe the authority a package requests; trusted Aurora host policy decides whether that authority is admitted.

`PackageInstaller` exposes `executionPolicy` as a programmatic host API. When it is omitted, Aurora uses the default package execution policy and `host.secrets.read` remains denied. Secret authority is admitted only through `packageSecretGrants`. Each grant identifies an exact `publisherId`, exact `packageId`, and explicit secret-name list. Generic `allowedCapabilities` cannot authorize `host.secrets.read`, even if a caller includes that capability there.

A package secret request is authorized only when the authenticated manifest publisher ID, manifest package ID, declared secret name, and trusted `packageSecretGrants` entry all match. A grant for one package does not authorize another package from the same publisher, and a grant for one publisher does not authorize a package with the same ID from another publisher. A grant for one declared secret does not authorize another declared secret.

Package secret authority does not propagate through dependency relationships. Granting a root package access to a secret does not grant `host.secrets.read` to any dependency processed by the same installation transaction or shared `PackageWorker`. Each dependency that requires secret access must receive its own matching publisher/package/secret grant.

The normal Aurora package-install CLI does not expose an option for granting `host.secrets.read`. Package manifests, project configuration, environment variables, repair flows, and update flows also cannot grant this host authority. This separation prevents package-controlled input from promoting its own privileges.

When trusted host policy admits secret access, `PackageWorker` keeps credential access in host code. The worker receives only `context.secrets.read(name)` and cannot directly instantiate the operating-system credential store or native keyring implementation.

Each released secret value is tracked only for the lifetime of the individual worker execution. Aurora applies exact-value redaction to worker logs, captured stdout, captured stderr, and worker failure messages, and rejects privileged host requests that attempt to write an exact released secret value.

Exact-value redaction is defense in depth, not a confidentiality boundary against code that has deliberately been authorized to receive a raw secret. Authorized package code can transform, encode, split, hash, or otherwise derive data from a secret in ways that exact-value matching cannot reliably detect. For that reason, `host.secrets.read` is a high-trust capability and must remain an explicit host admission decision.

Required secret declarations fail closed when the package-scoped credential is absent. Optional secret declarations return `null`. Every credential-store read remains host-owned and auditable.
## Dependencies, conflicts, and lifecycle

Dependencies contain `id`, `version`, and `optional`. Missing optional dependencies are skipped; required dependencies must exist and satisfy the declared range. A package cannot depend on itself, conflict with itself, or list the same package as both a dependency and a conflict.

Platform declarations can use `any` or specific Node.js operating-system and architecture values, but cannot combine `any` with specific values.

Set `lifecycle.deprecated` or `lifecycle.revoked` to `true` only with a non-empty `reason`. Revoked packages cannot be installed. A deprecated or revoked package may name a different canonical package ID as its `replacement`.

Publisher, provenance, and optional link URLs must use HTTPS.
