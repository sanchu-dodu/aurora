import {
  spawn,
} from "node:child_process";

import path from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  redactSensitiveValue,
  redactText,
} from "../../security/secretRedactor.js";

import {
  validateExtensionManifest,
  type ExtensionCapability,
  type ExtensionManifest,
} from "./extensionManifest.js";

import type {
  ExtensionLifecycle,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionWorkerMessage,
} from "./extensionWorkerProtocol.js";

const BROKERED_CAPABILITIES =
  new Set<ExtensionCapability>([
    "aurora.output.write",
    "host.environment.read",
  ]);

const DEFAULT_ALLOWED_CAPABILITIES = [
  "aurora.output.write",
] as const;

const activeExtensions =
  new Set<string>();

export interface ExtensionPolicy {
  readonly allowedCapabilities?:
    readonly ExtensionCapability[];

  readonly allowedTrustLevels?:
    readonly ExtensionManifest["trust"][];

  readonly environment?:
    Readonly<
      Record<
        string,
        string | undefined
      >
    >;
}

export interface ExtensionRunOptions {
  readonly policy?: ExtensionPolicy;

  readonly writeOutput?:
    (message: string) => void;
}

export interface ExtensionRunResult {
  readonly extensionId: string;
  readonly lifecycle:
    ExtensionLifecycle;
  readonly value?: unknown;
  readonly stdout: string;
  readonly stderr: string;
}

export class ExtensionWorkerHost {
  async run(
    untrustedManifest: unknown,
    extensionRoot: string,
    lifecycle:
      ExtensionLifecycle,
    options:
      ExtensionRunOptions = {}
  ): Promise<ExtensionRunResult> {
    const manifest =
      validateExtensionManifest(
        untrustedManifest
      );

    evaluatePolicy(
      manifest,
      options.policy
    );

    if (
      activeExtensions.has(
        manifest.id
      )
    ) {
      throw extensionError(
        ErrorCodes
          .EXTENSION_CONCURRENCY_LIMIT,
        `Extension '${manifest.id}' is already running.`
      );
    }

    const boundary =
      new ProjectPathBoundary(
        extensionRoot
      );

    const entry =
      boundary.resolve(
        manifest.entry
      );

    activeExtensions.add(
      manifest.id
    );

    try {
      return await this.runChild(
        manifest,
        boundary.projectRoot,
        entry,
        lifecycle,
        options
      );
    } finally {
      activeExtensions.delete(
        manifest.id
      );
    }
  }

  private runChild(
    manifest: ExtensionManifest,
    extensionRoot: string,
    entry: string,
    lifecycle:
      ExtensionLifecycle,
    options: ExtensionRunOptions
  ): Promise<ExtensionRunResult> {
    const workerEntry =
      fileURLToPath(
        new URL(
          "./extensionWorkerRuntime.js",
          import.meta.url
        )
      );

    const workerRoot =
      path.dirname(workerEntry);

    const redactionValues =
      collectRedactionValues(
        options.policy
          ?.environment
      );

    return new Promise(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          createExtensionWorkerArgs(
            manifest,
            workerRoot,
            extensionRoot,
            workerEntry,
            entry,
            manifest.limits
              .maxOutputBytes,
            lifecycle
          ),
          {
            cwd: extensionRoot,
            env:
              createWorkerEnvironment(),
            shell: false,
            windowsHide: true,
            stdio: [
              "ignore",
              "pipe",
              "pipe",
              "ipc",
            ],
          }
        );

        const stdoutChunks:
          Buffer[] = [];
        const stderrChunks:
          Buffer[] = [];

        let outputBytes = 0;
        let completedValue:
          unknown;
        let completionReceived =
          false;
        let termination:
          "output" |
          "timeout" |
          undefined;
        let settled = false;

        const terminate = (
          reason:
            "output" | "timeout"
        ) => {
          if (termination) {
            return;
          }

          termination = reason;
          child.kill("SIGKILL");
        };

        const countOutput = (
          byteLength: number
        ): boolean => {
          outputBytes += byteLength;

          if (
            outputBytes >
            manifest.limits
              .maxOutputBytes
          ) {
            terminate("output");
            return false;
          }

          return true;
        };

        const collect = (
          chunks: Buffer[],
          value: Buffer | string
        ) => {
          const chunk =
            Buffer.isBuffer(value)
              ? value
              : Buffer.from(value);

          if (
            countOutput(
              chunk.byteLength
            )
          ) {
            chunks.push(chunk);
          }
        };

        child.stdout?.on(
          "data",
          value => {
            collect(
              stdoutChunks,
              value
            );
          }
        );

        child.stderr?.on(
          "data",
          value => {
            collect(
              stderrChunks,
              value
            );
          }
        );

        const timeout = setTimeout(
          () => {
            terminate("timeout");
          },
          manifest.limits.timeoutMs
        );

        child.on(
          "message",
          (message: unknown) => {
            if (
              !isWorkerMessage(message)
            ) {
              child.kill("SIGKILL");
              return;
            }

            if (
              !countOutput(
                serializedByteLength(
                  message
                )
              )
            ) {
              return;
            }

            if (
              message.type ===
              "limit"
            ) {
              terminate(
                message.limit
              );
              return;
            }

            if (
              message.type ===
              "request"
            ) {
              handleRequest(
                child,
                message,
                manifest,
                options,
                redactionValues
              );
              return;
            }

            if (
              message.type ===
              "failed"
            ) {
              completedValue =
                extensionError(
                  ErrorCodes
                    .EXTENSION_EXECUTION_FAILED,
                  `Extension '${manifest.id}' failed: ${redactText(message.error, redactionValues)}`
                );
              completionReceived =
                true;
              return;
            }

            completedValue =
              redactSensitiveValue(
                message.value,
                redactionValues
              );
            completionReceived = true;
          }
        );

        child.once(
          "error",
          error => {
            if (settled) {
              return;
            }

            settled = true;
            clearTimeout(timeout);

            reject(
              extensionError(
                ErrorCodes
                  .EXTENSION_EXECUTION_FAILED,
                `Extension '${manifest.id}' could not be started.`,
                error
              )
            );
          }
        );

        child.once(
          "close",
          (exitCode, signal) => {
            if (settled) {
              return;
            }

            settled = true;
            clearTimeout(timeout);

            const stdout =
              redactText(
                Buffer.concat(
                  stdoutChunks
                ).toString("utf8"),
                redactionValues
              );
            const stderr =
              redactText(
                Buffer.concat(
                  stderrChunks
                ).toString("utf8"),
                redactionValues
              );

            if (
              termination ===
              "timeout"
            ) {
              reject(
                extensionError(
                  ErrorCodes
                    .EXTENSION_TIMEOUT,
                  `Extension '${manifest.id}' exceeded its ${manifest.limits.timeoutMs} ms timeout.`
                )
              );
              return;
            }

            if (
              termination ===
              "output"
            ) {
              reject(
                extensionError(
                  ErrorCodes
                    .EXTENSION_OUTPUT_LIMIT,
                  `Extension '${manifest.id}' exceeded its ${manifest.limits.maxOutputBytes} byte output limit.`
                )
              );
              return;
            }

            if (
              completedValue instanceof
                AuroraError
            ) {
              reject(completedValue);
              return;
            }

            if (
              exitCode !== 0 ||
              signal !== null ||
              !completionReceived
            ) {
              reject(
                extensionError(
                  ErrorCodes
                    .EXTENSION_EXECUTION_FAILED,
                  `Extension '${manifest.id}' exited without a valid completion result.`,
                  {
                    exitCode,
                    signal,
                    stderr,
                  }
                )
              );
              return;
            }

            resolve({
              extensionId:
                manifest.id,
              lifecycle,
              value: completedValue,
              stdout,
              stderr,
            });
          }
        );
      }
    );
  }
}

export function createExtensionWorkerArgs(
  manifest: ExtensionManifest,
  workerRoot: string,
  extensionRoot: string,
  workerEntry: string,
  extensionEntry: string,
  maxOutputBytes: number,
  lifecycle:
    ExtensionLifecycle
): string[] {
  return [
    "--permission",
    `--allow-fs-read=${workerRoot}`,
    `--allow-fs-read=${extensionRoot}`,
    `--max-old-space-size=${manifest.limits.maxOldGenerationSizeMb}`,
    workerEntry,
    extensionEntry,
    extensionRoot,
    String(maxOutputBytes),
    lifecycle,
  ];
}

function handleRequest(
  child:
    ReturnType<typeof spawn>,
  request: ExtensionRequest,
  manifest: ExtensionManifest,
  options: ExtensionRunOptions,
  redactionValues:
    readonly string[]
): void {
  try {
    const declared =
      manifest.capabilities.includes(
        request.capability
      );

    const allowed =
      new Set(
        options.policy
          ?.allowedCapabilities ??
        DEFAULT_ALLOWED_CAPABILITIES
      ).has(request.capability);

    if (!declared || !allowed) {
      sendResponse(child, {
        type: "response",
        requestId:
          request.requestId,
        ok: false,
        error:
          `Capability '${request.capability}' is not declared and allowed.`,
      });
      return;
    }

    if (
      request.capability ===
        "aurora.output.write" &&
      request.action === "write" &&
      typeof request.input === "string"
    ) {
      const message =
        redactText(
          request.input,
          redactionValues
        );

      options.writeOutput
        ?.(message);

      sendResponse(child, {
        type: "response",
        requestId:
          request.requestId,
        ok: true,
      });
      return;
    }

    if (
      request.capability ===
        "host.environment.read" &&
      request.action === "read" &&
      typeof request.input === "string"
    ) {
      sendResponse(child, {
        type: "response",
        requestId:
          request.requestId,
        ok: true,
        value:
          options.policy
            ?.environment
            ?.[request.input],
      });
      return;
    }

    sendResponse(child, {
      type: "response",
      requestId: request.requestId,
      ok: false,
      error:
        `Extension request '${request.action}' is not supported for '${request.capability}'.`,
    });
  } catch (error) {
    sendResponse(child, {
      type: "response",
      requestId: request.requestId,
      ok: false,
      error:
        `Extension capability broker failed: ${redactText(
          error instanceof Error
            ? error.message
            : String(error),
          redactionValues
        )}`,
    });
  }
}

function sendResponse(
  child:
    ReturnType<typeof spawn>,
  response: ExtensionResponse
): void {
  if (!child.connected) {
    return;
  }

  try {
    child.send(
      response,
      error => {
        if (error) {
          child.kill("SIGKILL");
        }
      }
    );
  } catch {
    child.kill("SIGKILL");
  }
}

function evaluatePolicy(
  manifest: ExtensionManifest,
  policy: ExtensionPolicy = {}
): void {
  const allowedTrustLevels =
    new Set(
      policy.allowedTrustLevels ??
      ["built-in"]
    );

  if (
    !allowedTrustLevels.has(
      manifest.trust
    )
  ) {
    throw extensionError(
      ErrorCodes
        .EXTENSION_PERMISSION_DENIED,
      `Extension '${manifest.id}' trust level '${manifest.trust}' is not allowed by policy.`
    );
  }

  const allowedCapabilities =
    new Set(
      policy.allowedCapabilities ??
      DEFAULT_ALLOWED_CAPABILITIES
    );

  for (
    const capability
    of manifest.capabilities
  ) {
    if (
      !BROKERED_CAPABILITIES.has(
        capability
      ) ||
      !allowedCapabilities.has(
        capability
      )
    ) {
      throw extensionError(
        ErrorCodes
          .EXTENSION_PERMISSION_DENIED,
        `Extension '${manifest.id}' capability '${capability}' is not supported and allowed by policy.`
      );
    }
  }
}

function createWorkerEnvironment():
  NodeJS.ProcessEnv {
  const environment:
    NodeJS.ProcessEnv = {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    };

  for (const name of [
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "WINDIR",
  ]) {
    if (process.env[name]) {
      environment[name] =
        process.env[name];
    }
  }

  return environment;
}

function collectRedactionValues(
  environment:
    ExtensionPolicy["environment"]
): string[] {
  return Object.values(
    environment ?? {}
  ).filter(
    (value): value is string =>
      typeof value === "string" &&
      value.length > 0
  );
}

function serializedByteLength(
  value: unknown
): number {
  try {
    return Buffer.byteLength(
      JSON.stringify(value)
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function isWorkerMessage(
  value: unknown
): value is ExtensionWorkerMessage {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const candidate = value as
    Partial<ExtensionWorkerMessage>;

  if (
    candidate.type === "limit"
  ) {
    return candidate.limit ===
      "output";
  }

  if (
    candidate.type ===
      "completed"
  ) {
    return true;
  }

  if (
    candidate.type === "failed"
  ) {
    return typeof candidate.error ===
      "string";
  }

  return (
    candidate.type === "request" &&
    typeof candidate.requestId ===
      "string" &&
    typeof candidate.capability ===
      "string" &&
    typeof candidate.action ===
      "string"
  );
}

function extensionError(
  code:
    typeof ErrorCodes[
      | "EXTENSION_CONCURRENCY_LIMIT"
      | "EXTENSION_EXECUTION_FAILED"
      | "EXTENSION_OUTPUT_LIMIT"
      | "EXTENSION_PERMISSION_DENIED"
      | "EXTENSION_TIMEOUT"
    ],
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    message,
    {
      code,
      suggestion:
        "Inspect the extension manifest, policy, and resource limits before retrying.",
      cause,
    }
  );
}
