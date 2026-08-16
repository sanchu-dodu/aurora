import {
  isBuiltin,
  registerHooks,
} from "node:module";

import fs from "node:fs";

import path from "node:path";

import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import type {
  PackageCapability,
} from "./packageCapabilityPolicy.js";

import type {
  PackageExecutableModule,
  PackageExecutionLifecycle,
  PackageExecutionResponse,
  PackageWorkerContext,
} from "./packageExecutionProtocol.js";

const entry =
  process.argv[2];

const packageRoot =
  process.argv[3];

const maxOutputBytes =
  Number(process.argv[4]);

const lifecycle =
  process.argv[5] as
    PackageExecutionLifecycle |
    undefined;

const sendToParentRaw =
  process.send?.bind(process);

const disconnectFromParent =
  process.disconnect?.bind(
    process
  );

const pending =
  new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();

let requestSequence = 0;
let sentBytes = 0;

class PackageOutputLimitError
extends Error {
  constructor() {
    super(
      "Package worker output limit exceeded."
    );

    this.name =
      "PackageOutputLimitError";
  }
}

if (
  entry &&
  packageRoot
) {
  installImportPolicy(
    packageRoot
  );

  installGlobalPolicy();
}

process.on(
  "message",
  (message: unknown) => {
    if (
      !isExecutionResponse(
        message
      )
    ) {
      return;
    }

    const request =
      pending.get(
        message.requestId
      );

    if (!request) {
      return;
    }

    pending.delete(
      message.requestId
    );

    if (message.ok) {
      request.resolve(
        message.value
      );
      return;
    }

    request.reject(
      new Error(
        message.error ??
        "Package capability request was denied."
      )
    );
  }
);

function request(
  capability:
    PackageCapability,
  action: string,
  input?: unknown
): Promise<unknown> {
  const requestId =
    `request-${++requestSequence}`;

  return new Promise(
    (resolve, reject) => {
      pending.set(
        requestId,
        {
          resolve,
          reject,
        }
      );

      void sendToParent({
        type: "request",
        requestId,
        capability,
        action,
        input,
      }).catch(
        error => {
          pending.delete(
            requestId
          );

          reject(error);
        }
      );
    }
  );
}

const context:
  PackageWorkerContext = {
    log(message) {
      void sendToParent({
        type: "log",
        message: String(message),
      }).catch(
        () => {
          // Worker failure is handled
          // by lifecycle completion.
        }
      );
    },

    async createFile(
      filePath,
      content
    ) {
      await request(
        "project.files.write",
        "createFile",
        {
          filePath,
          content,
        }
      );
    },

    project: {
      files: {
        async readText(
          filePath
        ) {
          const value =
            await request(
              "project.files.read",
              "readProjectFileText",
              {
                path:
                  filePath,
              }
            );

          if (value === null) {
            return null;
          }

          if (
            typeof value !==
              "string"
          ) {
            throw new Error(
              "Package project-file broker returned an invalid response."
            );
          }

          return value;
        },
      },
    },

    config: {
      async addDependency(
        packageName,
        version = "latest"
      ) {
        await request(
          "project.dependencies.write",
          "addDependency",
          {
            packageName,
            version,
          }
        );
      },
    },

    secrets: {
      async read(
        name
      ) {
        const value =
          await request(
            "host.secrets.read",
            "readSecret",
            {
              name,
            }
          );

        if (value === null) {
          return null;
        }

        if (
          typeof value !==
            "string"
        ) {
          throw new Error(
            "Package secret broker returned an invalid response."
          );
        }

        return value;
      },
    },

    host: {
      environment: {
        async read(
          name
        ) {
          const value =
            await request(
              "host.environment.read",
              "readEnvironment",
              {
                name,
              }
            );

          if (value === null) {
            return null;
          }

          if (
            typeof value !==
              "string"
          ) {
            throw new Error(
              "Package host environment broker returned an invalid response."
            );
          }

          return value;
        },
      },
    },

    env: {
      async addVariables(
        variables
      ) {
        await request(
          "project.environment.write",
          "addVariables",
          variables
        );
      },
    },
  };

try {
  if (
    !entry ||
    !packageRoot ||
    !Number.isSafeInteger(
      maxOutputBytes
    ) ||
    maxOutputBytes <= 0 ||
    (
      lifecycle !==
        "beforeInstall" &&
      lifecycle !==
        "install" &&
      lifecycle !==
        "afterInstall"
    )
  ) {
    throw new Error(
      "Package worker received an invalid invocation."
    );
  }

  const module =
    await import(
      pathToFileURL(entry).href
    ) as PackageExecutableModule;

  const handler =
    module[lifecycle];

  if (handler === undefined) {
    await sendToParent({
      type: "completed",
      executed: false,
    });
  }
  else {
    if (
      typeof handler !==
      "function"
    ) {
      throw new Error(
        `Package lifecycle export '${lifecycle}' is not a function.`
      );
    }

    await handler(context);

    await sendToParent({
      type: "completed",
      executed: true,
    });
  }
}
catch (error) {
  if (
    !(
      error instanceof
      PackageOutputLimitError
    )
  ) {
    try {
      await sendToParent({
        type: "failed",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
    catch {
      // Host treats missing
      // completion as failure.
    }
  }
}
finally {
  disconnectFromParent?.();
}

async function sendToParent(
  message: unknown
): Promise<void> {
  if (!sendToParentRaw) {
    throw new Error(
      "Package worker IPC is unavailable."
    );
  }

  const bytes =
    serializedByteLength(
      message
    );

  if (
    sentBytes + bytes >
    maxOutputBytes
  ) {
    await sendRaw({
      type: "limit",
      limit: "output",
    });

    throw new PackageOutputLimitError();
  }

  sentBytes += bytes;

  await sendRaw(message);
}

function sendRaw(
  message: unknown
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      try {
        sendToParentRaw?.(
          message,
          error => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          }
        );
      }
      catch (error) {
        reject(error);
      }
    }
  );
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

function installImportPolicy(
  executionRoot: string
): void {
  const canonicalRoot =
    fs.realpathSync.native(
      path.resolve(
        executionRoot
      )
    );

  registerHooks({
    resolve(
      specifier,
      context,
      nextResolve
    ) {
      if (
        isBuiltin(specifier) ||
        (
          !specifier.startsWith(
            "./"
          ) &&
          !specifier.startsWith(
            "../"
          ) &&
          !specifier.startsWith(
            "file:"
          )
        )
      ) {
        throw new Error(
          `Package import '${specifier}' is not allowed by the execution policy.`
        );
      }

      const resolved =
        nextResolve(
          specifier,
          context
        );

      if (
        !resolved.url.startsWith(
          "file:"
        )
      ) {
        throw new Error(
          `Package import '${specifier}' did not resolve to a local file.`
        );
      }

      const resolvedPath =
        fileURLToPath(
          resolved.url
        );

      const canonicalPath =
        fs.realpathSync.native(
          resolvedPath
        );

      const relative =
        path.relative(
          canonicalRoot,
          canonicalPath
        );

      if (
        relative === ".." ||
        relative.startsWith(
          `..${path.sep}`
        ) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(
          `Package import '${specifier}' escapes its package root.`
        );
      }

      return resolved;
    },
  });

  Object.defineProperty(
    process,
    "getBuiltinModule",
    {
      configurable: false,
      enumerable: false,
      value() {
        throw new Error(
          "Direct built-in module access is not allowed by the package execution policy."
        );
      },
      writable: false,
    }
  );
}

function installGlobalPolicy():
  void {
  const denyNetwork = () => {
    throw new Error(
      "Direct network access is not allowed by the package execution policy."
    );
  };

  if (
    "fetch" in globalThis
  ) {
    Object.defineProperty(
      globalThis,
      "fetch",
      {
        configurable: false,
        enumerable: true,
        value: denyNetwork,
        writable: false,
      }
    );
  }

  for (const name of [
    "WebSocket",
    "EventSource",
  ]) {
    if (
      name in globalThis
    ) {
      Object.defineProperty(
        globalThis,
        name,
        {
          configurable: false,
          enumerable: true,
          value: denyNetwork,
          writable: false,
        }
      );
    }
  }

  for (const name of [
    "_linkedBinding",
    "binding",
    "dlopen",
    "kill",
  ]) {
    if (
      name in process
    ) {
      Object.defineProperty(
        process,
        name,
        {
          configurable: false,
          enumerable: false,
          value() {
            throw new Error(
              "Direct privileged process access is not allowed by the package execution policy."
            );
          },
          writable: false,
        }
      );
    }
  }

  for (const name of [
    "disconnect",
    "send",
  ]) {
    if (
      name in process
    ) {
      Object.defineProperty(
        process,
        name,
        {
          configurable: false,
          enumerable: false,
          value() {
            throw new Error(
              "Direct IPC access is not allowed by package code."
            );
          },
          writable: false,
        }
      );
    }
  }
}

function isExecutionResponse(
  value: unknown
): value is
  PackageExecutionResponse {
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
        PackageExecutionResponse
      >;

  return (
    candidate.type ===
      "response" &&
    typeof candidate.requestId ===
      "string" &&
    typeof candidate.ok ===
      "boolean"
  );
}
