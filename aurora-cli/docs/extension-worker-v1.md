# Extension Worker v1 prototype

Aurora's Extension Worker v1 prototype runs the bundled Hello extension in a separate Node.js process. It is the first implementation of the Secure Core extension execution boundary.

The prototype does not migrate package installers, hooks, migrations, or arbitrary third-party plugins. Those paths still require separate migration work before Aurora can describe the complete extension ecosystem as isolated.

## Trust boundary

Aurora validates an Extension Manifest v1 before launching a worker. A worker receives a scrubbed environment and a narrow IPC context instead of Aurora internals. The main process evaluates every requested capability and denies anything that is undeclared, unapproved, or not implemented by the broker.

The worker process supplies independent crash, timeout, memory, output, and concurrency containment. Node's Permission Model and Aurora's import policy add defense in depth by denying filesystem writes, privileged built-ins, child processes, worker threads, native addons, WASI, external packages, and imports outside the extension root.

Node documents that its Permission Model is a seat belt for trusted code rather than a complete malicious-code sandbox. Aurora therefore does not treat the prototype as sufficient isolation for hostile community extensions.

## Manifest

```json
{
  "manifestVersion": 1,
  "kind": "extension",
  "id": "hello",
  "name": "Hello Extension",
  "version": "1.0.0",
  "entry": "helloExtension.js",
  "trust": "built-in",
  "capabilities": [
    "aurora.output.write"
  ],
  "limits": {
    "timeoutMs": 2000,
    "maxOldGenerationSizeMb": 32,
    "maxOutputBytes": 8192
  }
}
```

The schema is strict. Unknown fields, duplicate capabilities, non-canonical identifiers, unsafe entry paths, invalid semantic versions, and out-of-range resource limits fail before launch.

Trust levels are `built-in`, `verified`, `community`, and `local-development`. The default prototype policy allows only `built-in` extensions.

## Capabilities

Extension Manifest v1 recognizes these capabilities:

- `aurora.output.write`
- `host.environment.read`
- `network.access`
- `process.execute`
- `project.files.read`
- `project.files.write`

The prototype broker implements only `aurora.output.write` and `host.environment.read`. All other capabilities fail closed even if a policy attempts to allow them.

Output is redacted and counted against the manifest output limit. Environment access returns only names and values explicitly supplied by the host policy; the child does not inherit the parent process environment.

## Resource limits

Every launch enforces:

- a wall-clock timeout between 100 milliseconds and 30 seconds
- a V8 old-generation heap ceiling between 16 MiB and 256 MiB
- a combined direct and brokered output ceiling between 256 bytes and 1 MiB
- one active invocation for a given extension identifier

Exceeding a limit terminates the worker and returns a stable Aurora error code.

## Sample lifecycle

The trusted adapter in `helloPlugin.js` registers normal Aurora plugin metadata. Its `activate` and `deactivate` methods launch `helloExtension.js` in the worker instead of executing that extension module in the main Aurora process.

Run the sample with:

```bash
aurora plugin list
```

The runtime output identifies when the Hello extension activates and stops inside its worker.

## Current non-goals

- exposing project files, network, subprocess, or secrets to extensions
- loading arbitrary third-party extension roots
- claiming an operating-system-grade sandbox
- replacing the existing package installer and hook loaders
- organization policy distribution, revocation, quarantine, or signatures

These remain explicit follow-up milestones.
