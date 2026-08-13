import {
  spawn,
} from "node:child_process";

import fs from "node:fs";
import path from "node:path";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

import {
  redactText,
} from "../security/secretRedactor.js";

const SAFE_COMMANDS = [
  "bun",
  "git",
  "node",
  "npm",
  "pnpm",
  "yarn",
] as const;

const SAFE_COMMAND_SET =
  new Set<string>(
    SAFE_COMMANDS
  );

const SAFE_ENVIRONMENT_NAMES =
  new Set([
    "APPDATA",
    "CI",
    "COLORTERM",
    "COMSPEC",
    "FORCE_COLOR",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOCALAPPDATA",
    "NODE_AUTH_TOKEN",
    "NO_COLOR",
    "NO_PROXY",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_PREFIX",
    "NPM_CONFIG_REGISTRY",
    "NPM_CONFIG_USERCONFIG",
    "NPM_TOKEN",
    "PATH",
    "PATHEXT",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ]);

const SECRET_ENVIRONMENT_NAME =
  /(TOKEN|PASSWORD|SECRET|PROXY)$/iu;

const DEFAULT_TIMEOUT_MS =
  60_000;

const DEFAULT_MAX_OUTPUT_BYTES =
  5 * 1024 * 1024;

const PROCESS_SUGGESTION =
  "Use an allowlisted executable, argument arrays, and a valid working directory.";

export type SafeProcessCommand =
  typeof SAFE_COMMANDS[number];

export type ProcessOutputMode =
  | "capture"
  | "inherit"
  | "ignore";

export interface SafeProcessRequest {
  command: SafeProcessCommand;

  args?: readonly string[];

  cwd?: string;

  environment?:
    Readonly<
      Record<
        string,
        string | undefined
      >
    >;

  output?: ProcessOutputMode;

  timeoutMs?: number;

  maxOutputBytes?: number;

  signal?: AbortSignal;

  rejectOnNonZero?: boolean;

  redactValues?:
    readonly string[];
}

export interface SafeProcessResult {
  command: SafeProcessCommand;

  exitCode: number | null;

  signal: NodeJS.Signals | null;

  stdout: string;

  stderr: string;
}

export type SafeProcessRunner =
  (
    request: SafeProcessRequest
  ) => Promise<SafeProcessResult>;

interface ResolvedInvocation {
  executable: string;

  args: string[];
}

type TerminationReason =
  | "aborted"
  | "output"
  | "timeout";

export async function runProcess(
  request: SafeProcessRequest
): Promise<SafeProcessResult> {
  const command =
    validateCommand(
      request.command
    );

  const args =
    validateArguments(
      request.args ?? []
    );

  const cwd =
    resolveWorkingDirectory(
      request.cwd ??
      process.cwd()
    );

  const environment =
    createEnvironment(
      request.environment
    );

  const output =
    request.output ??
    "capture";

  const timeoutMs =
    validatePositiveInteger(
      request.timeoutMs ??
      DEFAULT_TIMEOUT_MS,
      "Process timeout"
    );

  const maxOutputBytes =
    validatePositiveInteger(
      request.maxOutputBytes ??
      DEFAULT_MAX_OUTPUT_BYTES,
      "Process output limit"
    );

  const redactValues =
    collectRedactions(
      environment,
      request.redactValues ?? []
    );

  if (
    request.signal?.aborted
  ) {
    throw processError(
      ErrorCodes.PROCESS_ABORTED,
      `Process '${command}' was aborted before it started.`
    );
  }

  const invocation =
    resolveInvocation(
      command,
      args,
      environment
    );

  return new Promise(
    (resolve, reject) => {
      let child:
        ReturnType<typeof spawn>;

      try {
        child = spawn(
          invocation.executable,
          invocation.args,
          {
            cwd,
            env: environment,
            shell: false,
            windowsHide: true,
            stdio:
              output === "ignore"
                ? [
                    "ignore",
                    "ignore",
                    "ignore",
                  ]
                : [
                    "ignore",
                    "pipe",
                    "pipe",
                  ],
          }
        );
      } catch (error) {
        reject(
          processError(
            ErrorCodes
              .PROCESS_EXECUTION_FAILED,
            `Process '${command}' could not be started.`,
            error
          )
        );

        return;
      }

      const stdoutChunks:
        Buffer[] = [];

      const stderrChunks:
        Buffer[] = [];

      let outputBytes = 0;
      let terminationReason:
        TerminationReason | undefined;
      let settled = false;

      const terminate =
        (
          reason:
            TerminationReason
        ) => {
          if (terminationReason) {
            return;
          }

          terminationReason =
            reason;

          child.kill();
        };

      const collect =
        (
          chunks: Buffer[],
          value: Buffer | string
        ) => {
          const chunk =
            Buffer.isBuffer(value)
              ? value
              : Buffer.from(value);

          outputBytes +=
            chunk.byteLength;

          if (
            outputBytes >
            maxOutputBytes
          ) {
            terminate("output");
            return;
          }

          chunks.push(chunk);
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
            terminate("timeout");
          },
          timeoutMs
        );

      const abort = () => {
        terminate("aborted");
      };

      request.signal?.addEventListener(
        "abort",
        abort,
        {
          once: true,
        }
      );

      if (
        request.signal?.aborted
      ) {
        abort();
      }

      const cleanup = () => {
        clearTimeout(timeout);

        request.signal
          ?.removeEventListener(
            "abort",
            abort
          );
      };

      child.once(
        "error",
        error => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();

          reject(
            processError(
              ErrorCodes
                .PROCESS_EXECUTION_FAILED,
              `Process '${command}' could not be started.`,
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
          cleanup();

          const stdout =
            redactText(
              Buffer.concat(
                stdoutChunks
              ).toString("utf8"),
              redactValues
            );

          const stderr =
            redactText(
              Buffer.concat(
                stderrChunks
              ).toString("utf8"),
              redactValues
            );

          if (output === "inherit") {
            if (stdout) {
              process.stdout.write(
                stdout
              );
            }

            if (stderr) {
              process.stderr.write(
                stderr
              );
            }
          }

          const result:
            SafeProcessResult = {
              command,
              exitCode,
              signal,
              stdout,
              stderr,
            };

          if (
            terminationReason ===
            "timeout"
          ) {
            reject(
              processError(
                ErrorCodes
                  .PROCESS_TIMEOUT,
                `Process '${command}' exceeded its ${timeoutMs} ms timeout.`,
                result
              )
            );

            return;
          }

          if (
            terminationReason ===
            "aborted"
          ) {
            reject(
              processError(
                ErrorCodes
                  .PROCESS_ABORTED,
                `Process '${command}' was aborted.`,
                result
              )
            );

            return;
          }

          if (
            terminationReason ===
            "output"
          ) {
            reject(
              processError(
                ErrorCodes
                  .PROCESS_OUTPUT_LIMIT,
                `Process '${command}' exceeded its ${maxOutputBytes} byte output limit.`,
                result
              )
            );

            return;
          }

          if (
            exitCode !== 0 &&
            request.rejectOnNonZero !==
              false
          ) {
            reject(
              processError(
                ErrorCodes
                  .PROCESS_EXECUTION_FAILED,
                `Process '${command}' exited with code ${exitCode ?? "unknown"}.`,
                result
              )
            );

            return;
          }

          resolve(result);
        }
      );
    }
  );
}

export async function runCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<void> {
  await runProcess({
    command:
      command as SafeProcessCommand,
    args,
    cwd,
    output: "inherit",
    timeoutMs:
      10 * 60_000,
  });
}

function validateCommand(
  command: string
): SafeProcessCommand {
  if (
    !SAFE_COMMAND_SET.has(
      command
    )
  ) {
    throw processError(
      ErrorCodes
        .UNSAFE_PROCESS_REQUEST,
      `Process executable '${command}' is not allowlisted.`
    );
  }

  return command as
    SafeProcessCommand;
}

function validateArguments(
  args: readonly string[]
): string[] {
  return args.map(
    argument => {
      if (
        typeof argument !==
          "string" ||
        /[\u0000\r\n]/u.test(
          argument
        )
      ) {
        throw processError(
          ErrorCodes
            .UNSAFE_PROCESS_REQUEST,
          "Process arguments must be strings without NUL or newline characters."
        );
      }

      return argument;
    }
  );
}

function validatePositiveInteger(
  value: number,
  label: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw processError(
      ErrorCodes
        .UNSAFE_PROCESS_REQUEST,
      `${label} must be a positive integer.`
    );
  }

  return value;
}

function resolveWorkingDirectory(
  cwd: string
): string {
  if (
    !cwd.trim() ||
    cwd.includes("\0")
  ) {
    throw processError(
      ErrorCodes
        .UNSAFE_PROCESS_REQUEST,
      "Process working directory is empty or invalid."
    );
  }

  try {
    const canonical =
      fs.realpathSync.native(
        path.resolve(cwd)
      );

    if (
      !fs.statSync(
        canonical
      ).isDirectory()
    ) {
      throw new Error(
        "Working directory is not a directory."
      );
    }

    return canonical;
  } catch (error) {
    throw processError(
      ErrorCodes
        .UNSAFE_PROCESS_REQUEST,
      `Process working directory '${cwd}' cannot be safely resolved.`,
      error
    );
  }
}

function createEnvironment(
  overrides:
    SafeProcessRequest["environment"]
): NodeJS.ProcessEnv {
  const environment:
    NodeJS.ProcessEnv = {};

  for (
    const [name, value]
    of Object.entries(
      process.env
    )
  ) {
    if (
      value !== undefined &&
      SAFE_ENVIRONMENT_NAMES.has(
        name.toUpperCase()
      )
    ) {
      setEnvironmentValue(
        environment,
        name,
        value
      );
    }
  }

  for (
    const [name, value]
    of Object.entries(
      overrides ?? {}
    )
  ) {
    const normalizedName =
      name.toUpperCase();

    if (
      !SAFE_ENVIRONMENT_NAMES.has(
        normalizedName
      )
    ) {
      throw processError(
        ErrorCodes
          .UNSAFE_PROCESS_REQUEST,
        `Process environment variable '${name}' is not allowlisted.`
      );
    }

    if (
      value === undefined
    ) {
      removeEnvironmentValue(
        environment,
        normalizedName
      );

      continue;
    }

    if (
      value.includes("\0")
    ) {
      throw processError(
        ErrorCodes
          .UNSAFE_PROCESS_REQUEST,
        `Process environment variable '${name}' contains a NUL character.`
      );
    }

    setEnvironmentValue(
      environment,
      name,
      value
    );
  }

  return environment;
}

function setEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  value: string
): void {
  removeEnvironmentValue(
    environment,
    name.toUpperCase()
  );

  environment[name] =
    value;
}

function removeEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  normalizedName: string
): void {
  for (
    const existingName
    of Object.keys(environment)
  ) {
    if (
      existingName.toUpperCase() ===
      normalizedName
    ) {
      delete environment[
        existingName
      ];
    }
  }
}

function collectRedactions(
  environment: NodeJS.ProcessEnv,
  requestedValues:
    readonly string[]
): string[] {
  const values =
    new Set<string>();

  for (
    const [name, value]
    of Object.entries(environment)
  ) {
    if (
      value &&
      SECRET_ENVIRONMENT_NAME
        .test(name)
    ) {
      values.add(value);
    }
  }

  for (
    const value
    of requestedValues
  ) {
    if (value) {
      values.add(value);
    }
  }

  return Array.from(values)
    .sort(
      (left, right) =>
        right.length -
        left.length
    );
}

function resolveInvocation(
  command: SafeProcessCommand,
  args: string[],
  environment: NodeJS.ProcessEnv
): ResolvedInvocation {
  if (command === "node") {
    return {
      executable:
        process.execPath,
      args,
    };
  }

  const executable =
    findExecutable(
      command,
      environment
    );

  if (
    process.platform === "win32" &&
    command === "npm"
  ) {
    const npmCli =
      findNpmCli(executable);

    if (npmCli) {
      return {
        executable:
          process.execPath,
        args: [
          npmCli,
          ...args,
        ],
      };
    }
  }

  const extension =
    path.extname(executable)
      .toLowerCase();

  if (
    process.platform !== "win32" ||
    (
      extension !== ".cmd" &&
      extension !== ".bat"
    )
  ) {
    return {
      executable,
      args,
    };
  }

  const script =
    findNodeShimScript(
      executable
    );

  if (script) {
    return {
      executable:
        process.execPath,
      args: [
        script,
        ...args,
      ],
    };
  }

  throw processError(
    ErrorCodes
      .PROCESS_EXECUTION_FAILED,
    `Windows command shim for '${command}' does not expose a safe Node.js entry point.`
  );
}

function findExecutable(
  command: SafeProcessCommand,
  environment: NodeJS.ProcessEnv
): string {
  const pathValue =
    getEnvironmentValue(
      environment,
      "PATH"
    );

  if (!pathValue) {
    throw processError(
      ErrorCodes
        .PROCESS_EXECUTION_FAILED,
      `Process executable '${command}' could not be resolved because PATH is unavailable.`
    );
  }

  const extensions =
    process.platform === "win32"
      ? [
          ".exe",
          ".com",
          ".cmd",
          ".bat",
        ]
      : [
          "",
        ];

  for (
    const directory
    of pathValue.split(
      path.delimiter
    )
  ) {
    if (!directory) {
      continue;
    }

    for (
      const extension
      of extensions
    ) {
      const candidate =
        path.join(
          directory,
          `${command}${extension}`
        );

      try {
        fs.accessSync(
          candidate,
          process.platform ===
            "win32"
            ? fs.constants.F_OK
            : fs.constants.X_OK
        );

        if (
          fs.statSync(
            candidate
          ).isFile()
        ) {
          return fs.realpathSync
            .native(candidate);
        }
      } catch {
        continue;
      }
    }
  }

  throw processError(
    ErrorCodes
      .PROCESS_EXECUTION_FAILED,
    `Process executable '${command}' was not found on PATH.`
  );
}

function findNpmCli(
  npmExecutable: string
): string | undefined {
  const candidates = [
    path.join(
      path.dirname(
        process.execPath
      ),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    ),
    path.join(
      path.dirname(
        npmExecutable
      ),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    ),
  ];

  for (
    const candidate
    of candidates
  ) {
    if (!candidate) {
      continue;
    }

    try {
      const canonical =
        fs.realpathSync.native(
          candidate
        );

      if (
        path.basename(
          canonical
        ) === "npm-cli.js" &&
        fs.statSync(
          canonical
        ).isFile()
      ) {
        return canonical;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function findNodeShimScript(
  executable: string
): string | undefined {
  let content: string;

  try {
    content =
      fs.readFileSync(
        executable,
        "utf8"
      );
  } catch {
    return undefined;
  }

  if (
    Buffer.byteLength(
      content,
      "utf8"
    ) > 64 * 1024
  ) {
    return undefined;
  }

  const shimDirectory =
    path.dirname(executable);

  const candidates:
    string[] = [];

  for (
    const line
    of content.split(/\r?\n/u)
  ) {
    const quotedScripts =
      line.matchAll(
        /"([^"\r\n]+\.(?:cjs|mjs|js))"/giu
      );

    for (
      const match
      of quotedScripts
    ) {
      candidates.push(
        match[1]
      );
    }

    const unquotedScripts =
      line.matchAll(
        /(?:^|\s)([^\s"]+\.(?:cjs|mjs|js))(?=\s|$)/giu
      );

    for (
      const match
      of unquotedScripts
    ) {
      candidates.push(
        match[1]
      );
    }
  }

  for (
    const candidate
    of candidates
  ) {
    const expanded =
      candidate.replace(
        /%~dp0/giu,
        `${shimDirectory}${path.sep}`
      );

    if (
      expanded.includes("%")
    ) {
      continue;
    }

    try {
      const canonical =
        fs.realpathSync.native(
          path.resolve(
            shimDirectory,
            expanded
          )
        );

      if (
        fs.statSync(
          canonical
        ).isFile()
      ) {
        return canonical;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function getEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  normalizedName: string
): string | undefined {
  for (
    const [name, value]
    of Object.entries(environment)
  ) {
    if (
      name.toUpperCase() ===
      normalizedName
    ) {
      return value;
    }
  }

  return undefined;
}

function processError(
  code:
    typeof ErrorCodes[
      | "PROCESS_ABORTED"
      | "PROCESS_EXECUTION_FAILED"
      | "PROCESS_OUTPUT_LIMIT"
      | "PROCESS_TIMEOUT"
      | "UNSAFE_PROCESS_REQUEST"
    ],
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    message,
    {
      code,
      suggestion:
        PROCESS_SUGGESTION,
      cause,
    }
  );
}
