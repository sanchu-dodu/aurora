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
  redactText,
} from "../../security/secretRedactor.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import type {
  InstallerContext,
} from "../installer/installerContext.js";

import {
  PackageCapabilityPolicy,
} from "./packageCapabilityPolicy.js";

import {
  PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES,
  type PackageEnvironmentReader,
} from "./packageEnvironmentBroker.js";

import {
  PACKAGE_PROJECT_FILE_MAX_BYTES,
  type PackageProjectFileReader,
} from "./packageProjectFileReadBroker.js";

import {
  assertPackageProjectFileRead,
} from "./packageProjectFileReadPolicy.js";

import {
  assertPackageProjectFileWrite,
} from "./packageProjectWritePolicy.js";

import type {
  PackageSecretReader,
} from "./packageSecretBroker.js";

import type {
  PackageExecutionLifecycle,
  PackageExecutionRequest,
  PackageExecutionResponse,
  PackageExecutionWorkerMessage,
} from "./packageExecutionProtocol.js";

const PACKAGE_TIMEOUT_MS =
  30_000;

const PACKAGE_MAX_OUTPUT_BYTES =
  1024 * 1024;

const PACKAGE_MAX_OLD_SPACE_MB =
  128;

export const PACKAGE_ENVIRONMENT_LIFECYCLE_MAX_BYTES =
  256 * 1024;

export const PACKAGE_PROJECT_FILE_LIFECYCLE_MAX_BYTES =
  1024 * 1024;

const activeExecutions =
  new Set<string>();

export interface PackageExecutionResult {
  readonly packageId: string;
  readonly lifecycle:
    PackageExecutionLifecycle;
  readonly executed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export class PackageExecutionHost {
  constructor(
    private readonly policy =
      new PackageCapabilityPolicy(),
    private readonly secretReader?:
      PackageSecretReader,
    private readonly environmentReader?:
      PackageEnvironmentReader,
    private readonly projectFileReader?:
      PackageProjectFileReader
  ) {}

  async run(
    manifest: PackageManifest,
    packageRoot: string,
    relativeEntry: string,
    lifecycle:
      PackageExecutionLifecycle,
    context: InstallerContext
  ): Promise<PackageExecutionResult> {
    this.policy.assertManifest(
      manifest
    );

    this.policy.assertCapability(
      manifest,
      "package.code.execute"
    );

    const packageRootBoundary =
      new ProjectPathBoundary(
        packageRoot
      );

    const packageDirectory =
      packageRootBoundary.resolve(
        manifest.id
      );

    const packageBoundary =
      new ProjectPathBoundary(
        packageDirectory
      );

    const entry =
      packageBoundary.resolve(
        relativeEntry
      );

    const executionKey =
      `${context.getProjectPath()}\0${manifest.id}`;

    if (
      activeExecutions.has(
        executionKey
      )
    ) {
      throw packageExecutionError(
        ErrorCodes
          .PACKAGE_EXECUTION_FAILED,
        `Package '${manifest.id}' is already executing for this project.`
      );
    }

    activeExecutions.add(
      executionKey
    );

    try {
      return await this.runChild(
        manifest,
        packageDirectory,
        entry,
        lifecycle,
        context
      );
    }
    finally {
      activeExecutions.delete(
        executionKey
      );
    }
  }

  private runChild(
    manifest: PackageManifest,
    packageDirectory: string,
    entry: string,
    lifecycle:
      PackageExecutionLifecycle,
    context: InstallerContext
  ): Promise<PackageExecutionResult> {
    const workerEntry =
      fileURLToPath(
        new URL(
          "./packageExecutionRuntime.js",
          import.meta.url
        )
      );

    const workerRoot =
      path.dirname(
        workerEntry
      );

    return new Promise(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          createPackageWorkerArgs(
            workerRoot,
            packageDirectory,
            workerEntry,
            entry,
            lifecycle
          ),
          {
            cwd:
              packageDirectory,
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

        const releasedSecrets =
          new Set<string>();

        const environmentBudget = {
          releasedBytes: 0,
        };

        const projectFileBudget = {
          releasedBytes: 0,
        };

        let outputBytes = 0;

        let executed = false;

        let completionReceived =
          false;

        let executionFailure:
          AuroraError |
          undefined;

        let brokerFailure:
          AuroraError |
          undefined;

        let termination:
          "output" |
          "timeout" |
          undefined;

        let settled = false;

        const terminate = (
          reason:
            "output" |
            "timeout"
        ) => {
          if (termination) {
            return;
          }

          termination = reason;

          child.kill(
            "SIGKILL"
          );
        };

        const countOutput = (
          byteLength: number
        ): boolean => {
          outputBytes +=
            byteLength;

          if (
            outputBytes >
            PACKAGE_MAX_OUTPUT_BYTES
          ) {
            terminate(
              "output"
            );

            return false;
          }

          return true;
        };

        const collect = (
          chunks: Buffer[],
          value:
            Buffer |
            string
        ) => {
          const chunk =
            Buffer.isBuffer(
              value
            )
              ? value
              : Buffer.from(
                  value
                );

          if (
            countOutput(
              chunk.byteLength
            )
          ) {
            chunks.push(
              chunk
            );
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

        const timeout =
          setTimeout(
            () => {
              terminate(
                "timeout"
              );
            },
            PACKAGE_TIMEOUT_MS
          );

        child.on(
          "message",
          (message: unknown) => {
            if (
              !isWorkerMessage(
                message
              )
            ) {
              executionFailure =
                packageExecutionError(
                  ErrorCodes
                    .PACKAGE_EXECUTION_FAILED,
                  `Package '${manifest.id}' emitted an invalid worker message.`
                );

              child.kill(
                "SIGKILL"
              );

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
                "output"
              );

              return;
            }

            if (
              message.type ===
                "log"
            ) {
              context.log(
                redactText(
                  message.message,
                  [...releasedSecrets]
                )
              );

              return;
            }

            if (
              message.type ===
                "request"
            ) {
              void this.handleRequest(
                message,
                manifest,
                context,
                releasedSecrets,
                environmentBudget,
                projectFileBudget
              ).then(
                value => {
                  sendResponse(
                    child,
                    {
                      type:
                        "response",
                      requestId:
                        message.requestId,
                      ok: true,
                      value,
                    }
                  );
                }
              ).catch(
                error => {
                  const normalized =
                    error instanceof
                      AuroraError
                      ? error
                      : packageExecutionError(
                          ErrorCodes
                            .PACKAGE_EXECUTION_FAILED,
                          `Package '${manifest.id}' capability broker failed.`,
                          error
                        );

                  brokerFailure ??=
                    normalized;

                  /*
                   * A denied or invalid privileged request is
                   * terminal for this package execution.
                   *
                   * Do not return the denial to untrusted code
                   * and allow execution to continue. Preserve
                   * the authoritative host-side AuroraError and
                   * terminate the child immediately.
                   */
                  child.kill(
                    "SIGKILL"
                  );
                }
              );

              return;
            }

            if (
              message.type ===
                "failed"
            ) {
              executionFailure =
                packageExecutionError(
                  ErrorCodes
                    .PACKAGE_EXECUTION_FAILED,
                  `Package '${manifest.id}' failed during '${lifecycle}': ${redactText(message.error, [...releasedSecrets])}`
                );

              completionReceived =
                true;

              return;
            }

            executed =
              message.executed;

            completionReceived =
              true;
          }
        );

        child.once(
          "error",
          error => {
            if (settled) {
              return;
            }

            settled = true;

            clearTimeout(
              timeout
            );

            /*
             * A host-side capability denial is authoritative.
             *
             * Terminating a denied child may itself surface a
             * ChildProcess error. Do not let that secondary
             * transport error replace PACKAGE_PERMISSION_DENIED
             * or another broker-side AuroraError.
             */
            if (brokerFailure) {
              reject(
                brokerFailure
              );

              return;
            }

            reject(
              packageExecutionError(
                ErrorCodes
                  .PACKAGE_EXECUTION_FAILED,
                `Package '${manifest.id}' worker could not be started.`,
                error
              )
            );
          }
        );

        child.once(
          "exit",
          () => {
            /*
             * Hard execution limits are authoritative as soon
             * as the terminated worker process exits.
             *
             * Do not depend exclusively on ChildProcess "close":
             * close also waits for stdio closure and can leave
             * a large-output termination pending.
             */
            if (
              settled ||
              !termination
            ) {
              return;
            }

            settled = true;
            clearTimeout(timeout);

            reject(
              new AuroraError(
                termination ===
                "output"
                  ? `Package '${manifest.id}' exceeded the package output limit.`
                  : `Package '${manifest.id}' execution timed out.`,
                {
                  code:
                    termination ===
                    "output"
                      ? ErrorCodes
                          .PACKAGE_OUTPUT_LIMIT
                      : ErrorCodes
                          .PACKAGE_EXECUTION_TIMEOUT,
                }
              )
            );
          }
        );
        child.once(
          "close",
          (
            exitCode,
            signal
          ) => {
            if (settled) {
              return;
            }

            settled = true;

            clearTimeout(
              timeout
            );

            const stdout =
              redactText(
                Buffer.concat(
                  stdoutChunks
                ).toString(
                  "utf8"
                ),
                [...releasedSecrets]
              );

            const stderr =
              redactText(
                Buffer.concat(
                  stderrChunks
                ).toString(
                  "utf8"
                ),
                [...releasedSecrets]
              );

            if (
              termination ===
                "timeout"
            ) {
              reject(
                packageExecutionError(
                  ErrorCodes
                    .PACKAGE_EXECUTION_TIMEOUT,
                  `Package '${manifest.id}' exceeded its ${PACKAGE_TIMEOUT_MS} ms execution timeout.`
                )
              );

              return;
            }

            if (
              termination ===
                "output"
            ) {
              reject(
                packageExecutionError(
                  ErrorCodes
                    .PACKAGE_OUTPUT_LIMIT,
                  `Package '${manifest.id}' exceeded its ${PACKAGE_MAX_OUTPUT_BYTES} byte output limit.`
                )
              );

              return;
            }

            if (
              brokerFailure
            ) {
              reject(
                brokerFailure
              );

              return;
            }

            if (
              executionFailure
            ) {
              reject(
                executionFailure
              );

              return;
            }

            if (
              exitCode !== 0 ||
              signal !== null ||
              !completionReceived
            ) {
              reject(
                packageExecutionError(
                  ErrorCodes
                    .PACKAGE_EXECUTION_FAILED,
                  `Package '${manifest.id}' exited without a valid completion result.`,
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
              packageId:
                manifest.id,
              lifecycle,
              executed,
              stdout,
              stderr,
            });
          }
        );
      }
    );
  }

  private async handleRequest(
    request:
      PackageExecutionRequest,
    manifest: PackageManifest,
    context: InstallerContext,
    releasedSecrets: Set<string>,
    environmentBudget: {
      releasedBytes: number;
    },
    projectFileBudget: {
      releasedBytes: number;
    }
  ): Promise<unknown> {
    this.policy.assertCapability(
      manifest,
      request.capability
    );

    if (
      request.capability ===
        "project.files.read" &&
      request.action ===
        "readProjectFileText"
    ) {
      if (
        !isRecord(
          request.input
        ) ||
        Object.keys(
          request.input
        ).length !== 1 ||
        typeof request.input
          .path !==
          "string"
      ) {
        throw invalidRequest(
          manifest.id,
          request.action
        );
      }

      const relativePath =
        request.input.path;

      this.policy
        .assertProjectFileReadAccess(
          manifest,
          relativePath
        );

      assertPackageProjectFileRead(
        manifest.id,
        relativePath
      );

      if (!this.projectFileReader) {
        throw new AuroraError(
          `Package '${manifest.id}' requested project file '${relativePath}', but no trusted project-file reader is configured.`,
          {
            code:
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED,
            suggestion:
              "Configure Aurora's trusted host-side project-file broker before permitting project.files.read.",
          }
        );
      }

      const value =
        await this.projectFileReader
          .readProjectFileText(
            manifest,
            relativePath
          );

      const declaration =
        (manifest.projectFileReads ?? [])
          .find(
            candidate =>
              candidate.path ===
              relativePath
          );

      if (!declaration) {
        throw new AuroraError(
          `Package '${manifest.id}' attempted to read undeclared project file '${relativePath}'.`,
          {
            code:
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED,
          }
        );
      }

      if (value === null) {
        if (declaration.required) {
          throw new AuroraError(
            `Package '${manifest.id}' requires project file '${relativePath}', but no value is available.`,
            {
              code:
                ErrorCodes
                  .PACKAGE_PROJECT_FILE_REQUIRED,
            }
          );
        }

        return null;
      }

      if (
        typeof value !==
          "string" ||
        value.includes("\0")
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' project-file reader returned an invalid value for '${relativePath}'.`,
          {
            code:
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED,
          }
        );
      }

      const byteLength =
        Buffer.byteLength(
          value,
          "utf8"
        );

      if (
        byteLength >
        PACKAGE_PROJECT_FILE_MAX_BYTES
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' project file '${relativePath}' exceeded the ${PACKAGE_PROJECT_FILE_MAX_BYTES} byte per-file read limit.`,
          {
            code:
              ErrorCodes
                .PACKAGE_READ_LIMIT,
          }
        );
      }

      if (
        projectFileBudget.releasedBytes +
          byteLength >
        PACKAGE_PROJECT_FILE_LIFECYCLE_MAX_BYTES
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' exceeded the ${PACKAGE_PROJECT_FILE_LIFECYCLE_MAX_BYTES} byte project-file read budget for one lifecycle execution.`,
          {
            code:
              ErrorCodes
                .PACKAGE_READ_LIMIT,
            suggestion:
              "Reduce repeated project-file reads or request smaller explicitly declared project files.",
          }
        );
      }

      projectFileBudget.releasedBytes +=
        byteLength;

      return value;
    }

    if (
      request.capability ===
        "host.environment.read" &&
      request.action ===
        "readEnvironment"
    ) {
      if (
        !isRecord(
          request.input
        ) ||
        Object.keys(
          request.input
        ).length !== 1 ||
        typeof request.input
          .name !==
          "string"
      ) {
        throw invalidRequest(
          manifest.id,
          request.action
        );
      }

      const variableName =
        request.input.name;

      this.policy
        .assertEnvironmentAccess(
          manifest,
          variableName
        );

      if (!this.environmentReader) {
        throw new AuroraError(
          `Package '${manifest.id}' requested host environment variable '${variableName}', but no trusted host environment reader is configured.`,
          {
            code:
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED,
            suggestion:
              "Configure an explicit trusted non-secret host environment reader before permitting host.environment.read.",
          }
        );
      }

      const value =
        await this.environmentReader
          .readEnvironmentVariable(
            manifest,
            variableName
          );

      const declaration =
        (manifest.hostEnvironment ?? [])
          .find(
            candidate =>
              candidate.name ===
              variableName
          );

      if (!declaration) {
        throw new AuroraError(
          `Package '${manifest.id}' attempted to read undeclared host environment variable '${variableName}'.`,
          {
            code:
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED,
          }
        );
      }

      if (value === null) {
        if (declaration.required) {
          throw new AuroraError(
            `Package '${manifest.id}' requires host environment variable '${variableName}', but no value is available.`,
            {
              code:
                ErrorCodes
                  .PACKAGE_ENVIRONMENT_REQUIRED,
            }
          );
        }

        return null;
      }

      if (
        typeof value !==
          "string" ||
        value.includes("\0")
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' host environment reader returned an invalid value for '${variableName}'.`,
          {
            code:
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED,
          }
        );
      }

      const byteLength =
        Buffer.byteLength(
          value,
          "utf8"
        );

      if (
        byteLength >
        PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' host environment value '${variableName}' exceeded the per-value read limit.`,
          {
            code:
              ErrorCodes
                .PACKAGE_EXECUTION_FAILED,
          }
        );
      }

      if (
        environmentBudget.releasedBytes +
          byteLength >
        PACKAGE_ENVIRONMENT_LIFECYCLE_MAX_BYTES
      ) {
        throw new AuroraError(
          `Package '${manifest.id}' exceeded the ${PACKAGE_ENVIRONMENT_LIFECYCLE_MAX_BYTES} byte host environment read budget for one lifecycle execution.`,
          {
            code:
              ErrorCodes
                .PACKAGE_READ_LIMIT,
            suggestion:
              "Reduce host environment reads or move large data through a purpose-built bounded capability.",
          }
        );
      }

      environmentBudget.releasedBytes +=
        byteLength;

      return value;
    }

    if (
      request.capability ===
        "host.secrets.read" &&
      request.action ===
        "readSecret"
    ) {
      if (
        !isRecord(
          request.input
        ) ||
        Object.keys(
          request.input
        ).length !== 1 ||
        typeof request.input
          .name !==
          "string"
      ) {
        throw invalidRequest(
          manifest.id,
          request.action
        );
      }

      const secretName =
        request.input.name;

      const declared =
        (manifest.secrets ?? [])
          .some(
            secret =>
              secret.name ===
              secretName
          );

      if (!declared) {
        throw new AuroraError(
          `Package '${manifest.id}' attempted to read undeclared package secret '${secretName}'.`,
          {
            code:
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED,
            suggestion:
              "Declare the exact package secret in Manifest v1 before requesting it.",
          }
        );
      }

      this.policy
        .assertSecretAccess(
          manifest,
          secretName
        );

      if (!this.secretReader) {
        throw new AuroraError(
          `Package '${manifest.id}' requested package secret '${secretName}', but no host secret broker is configured.`,
          {
            code:
              ErrorCodes
                .PACKAGE_PERMISSION_DENIED,
            suggestion:
              "Configure Aurora's trusted host secret broker before permitting host.secrets.read.",
          }
        );
      }

      const secret =
        await this.secretReader
          .readSecret(
            manifest,
            secretName
          );

      if (secret !== null) {
        if (
          secret.length === 0 ||
          secret.includes("\0")
        ) {
          throw new AuroraError(
            `Package '${manifest.id}' secret broker returned an invalid secret value.`,
            {
              code:
                ErrorCodes
                  .PACKAGE_EXECUTION_FAILED,
            }
          );
        }

        releasedSecrets.add(
          secret
        );
      }

      return secret;
    }

    if (
      releasedSecrets.size > 0 &&
      containsReleasedSecret(
        request.input,
        releasedSecrets
      )
    ) {
      throw new AuroraError(
        `Package '${manifest.id}' attempted to send a released secret through privileged host request '${request.action}'.`,
        {
          code:
            ErrorCodes
              .PACKAGE_PERMISSION_DENIED,
          suggestion:
            "Do not write raw package secret values through privileged host requests.",
        }
      );
    }

    if (
      request.capability ===
        "project.files.write" &&
      request.action ===
        "createFile"
    ) {
      if (
        !isRecord(
          request.input
        ) ||
        typeof request.input
          .filePath !==
          "string" ||
        typeof request.input
          .content !==
          "string"
      ) {
        throw invalidRequest(
          manifest.id,
          request.action
        );
      }

      context.resolveProjectPath(
        request.input
          .filePath
      );

      assertPackageProjectFileWrite(
        manifest.id,
        request.input
          .filePath
      );

      await context.createFile(
        request.input
          .filePath,
        request.input
          .content
      );

      return undefined;
    }

    if (
      request.capability ===
        "project.dependencies.write" &&
      request.action ===
        "addDependency"
    ) {
      if (
        !isRecord(
          request.input
        ) ||
        typeof request.input
          .packageName !==
          "string" ||
        typeof request.input
          .version !==
          "string" ||
        request.input
          .packageName.length ===
          0 ||
        request.input
          .packageName.length >
          214 ||
        request.input
          .version.length ===
          0 ||
        request.input
          .version.length >
          256
      ) {
        throw invalidRequest(
          manifest.id,
          request.action
        );
      }

      await context.config
        .addDependency(
          request.input
            .packageName,
          request.input
            .version
        );

      return undefined;
    }

    if (
      request.capability ===
        "project.environment.write" &&
      request.action ===
        "addVariables"
    ) {
      if (
        !Array.isArray(
          request.input
        ) ||
        request.input.some(
          value =>
            typeof value !==
              "string" ||
            !/^[A-Z][A-Z0-9_]*$/.test(
              value
            )
        )
      ) {
        throw invalidRequest(
          manifest.id,
          request.action
        );
      }

      const declared =
        new Set(
          manifest.environment.map(
            variable =>
              variable.name
          )
        );

      for (
        const variable
        of request.input
      ) {
        if (
          !declared.has(
            variable
          )
        ) {
          throw new AuroraError(
            `Package '${manifest.id}' attempted to write undeclared environment variable '${variable}'.`,
            {
              code:
                ErrorCodes
                  .PACKAGE_PERMISSION_DENIED,
              suggestion:
                "Declare package environment variables in Manifest v1 before requesting them.",
            }
          );
        }
      }

      await context.env
        .addVariables(
          request.input
        );

      return undefined;
    }

    throw invalidRequest(
      manifest.id,
      request.action
    );
  }
}

function createPackageWorkerArgs(
  workerRoot: string,
  packageDirectory: string,
  workerEntry: string,
  packageEntry: string,
  lifecycle:
    PackageExecutionLifecycle
): string[] {
  return [
    "--permission",
    `--allow-fs-read=${workerRoot}`,
    `--allow-fs-read=${packageDirectory}`,
    `--max-old-space-size=${PACKAGE_MAX_OLD_SPACE_MB}`,
    workerEntry,
    packageEntry,
    packageDirectory,
    String(
      PACKAGE_MAX_OUTPUT_BYTES
    ),
    lifecycle,
  ];
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
    if (
      process.env[name]
    ) {
      environment[name] =
        process.env[name];
    }
  }

  return environment;
}

function sendResponse(
  child:
    ReturnType<
      typeof spawn
    >,
  response:
    PackageExecutionResponse
): void {
  if (
    !child.connected
  ) {
    return;
  }

  try {
    child.send(
      response,
      error => {
        if (error) {
          child.kill(
            "SIGKILL"
          );
        }
      }
    );
  }
  catch {
    child.kill(
      "SIGKILL"
    );
  }
}

function serializedByteLength(
  value: unknown
): number {
  try {
    return Buffer.byteLength(
      JSON.stringify(value)
    );
  }
  catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function isWorkerMessage(
  value: unknown
): value is
  PackageExecutionWorkerMessage {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const candidate =
    value as
      Partial<
        PackageExecutionWorkerMessage
      >;

  if (
    candidate.type ===
      "limit"
  ) {
    return candidate.limit ===
      "output";
  }

  if (
    candidate.type ===
      "log"
  ) {
    return typeof candidate.message ===
      "string";
  }

  if (
    candidate.type ===
      "completed"
  ) {
    return typeof candidate.executed ===
      "boolean";
  }

  if (
    candidate.type ===
      "failed"
  ) {
    return typeof candidate.error ===
      "string";
  }

  return (
    candidate.type ===
      "request" &&
    typeof candidate.requestId ===
      "string" &&
    typeof candidate.capability ===
      "string" &&
    typeof candidate.action ===
      "string"
  );
}

function containsReleasedSecret(
  value: unknown,
  releasedSecrets:
    ReadonlySet<string>
): boolean {
  if (typeof value === "string") {
    for (const secret of releasedSecrets) {
      if (
        secret.length > 0 &&
        value.includes(secret)
      ) {
        return true;
      }
    }

    return false;
  }

  if (Array.isArray(value)) {
    return value.some(
      item =>
        containsReleasedSecret(
          item,
          releasedSecrets
        )
    );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    return Object.values(value)
      .some(
        item =>
          containsReleasedSecret(
            item,
            releasedSecrets
          )
      );
  }

  return false;
}
function isRecord(
  value: unknown
): value is
  Record<string, unknown> {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function invalidRequest(
  packageId: string,
  action: string
): AuroraError {
  return packageExecutionError(
    ErrorCodes
      .PACKAGE_EXECUTION_FAILED,
    `Package '${packageId}' sent invalid or unsupported execution request '${action}'.`
  );
}

function packageExecutionError(
  code:
    typeof ErrorCodes[
      | "PACKAGE_EXECUTION_FAILED"
      | "PACKAGE_EXECUTION_TIMEOUT"
      | "PACKAGE_OUTPUT_LIMIT"
    ],
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    message,
    {
      code,
      suggestion:
        "Inspect the package manifest, verified artifact, and execution policy before retrying.",
      cause,
    }
  );
}
