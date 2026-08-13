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
  ExtensionCapability,
} from "./extensionManifest.js";

import type {
  ExtensionContext,
  ExtensionLifecycle,
  ExtensionModule,
  ExtensionResponse,
} from "./extensionWorkerProtocol.js";

const entry = process.argv[2];
const extensionRoot =
  process.argv[3];
const maxOutputBytes =
  Number(process.argv[4]);
const lifecycle =
  process.argv[5] as
    ExtensionLifecycle | undefined;

const sendToParentRaw =
  process.send?.bind(process);

const disconnectFromParent =
  process.disconnect?.bind(process);

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

class ExtensionOutputLimitError
extends Error {
  constructor() {
    super(
      "Extension worker output limit exceeded."
    );
    this.name =
      "ExtensionOutputLimitError";
  }
}

if (entry && extensionRoot) {
  installImportPolicy(
    extensionRoot
  );
  installGlobalPolicy();
}

process.on(
  "message",
  (message: unknown) => {
    if (!isExtensionResponse(message)) {
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
        "Extension request was denied."
      )
    );
  }
);

function request(
  capability: ExtensionCapability,
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
      }).catch(reject);
    }
  );
}

const context:
  ExtensionContext = {
    output: {
      async write(message) {
        await request(
          "aurora.output.write",
          "write",
          message
        );
      },
    },

    environment: {
      async read(name) {
        const value =
          await request(
            "host.environment.read",
            "read",
            name
          );

        return typeof value ===
          "string"
          ? value
          : undefined;
      },
    },
  };

try {
  if (
    !entry ||
    !extensionRoot ||
    !Number.isSafeInteger(
      maxOutputBytes
    ) ||
    maxOutputBytes <= 0 ||
    (
      lifecycle !== "activate" &&
      lifecycle !== "deactivate"
    )
  ) {
    throw new Error(
      "Extension worker received an invalid invocation."
    );
  }

  const module =
    await import(
      pathToFileURL(entry).href
    ) as ExtensionModule;

  const handler =
    module[lifecycle];

  const value = handler
    ? await handler(context)
    : undefined;

  await sendToParent({
    type: "completed",
    value,
  });
} catch (error) {
  if (
    !(error instanceof
      ExtensionOutputLimitError)
  ) {
    try {
      await sendToParent({
        type: "failed",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    } catch {
      // The host will treat a missing completion as a failed worker.
    }
  }
} finally {
  disconnectFromParent?.();
}

async function sendToParent(
  message: unknown
): Promise<void> {
  if (!sendToParentRaw) {
    throw new Error(
      "Extension worker IPC is unavailable."
    );
  }

  const messageBytes =
    serializedByteLength(message);

  if (
    sentBytes + messageBytes >
    maxOutputBytes
  ) {
    await sendRaw({
      type: "limit",
      limit: "output",
    });

    throw new ExtensionOutputLimitError();
  }

  sentBytes += messageBytes;
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
      } catch (error) {
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
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function installImportPolicy(
  extensionRoot: string
): void {
  const canonicalRoot =
    fs.realpathSync.native(
      path.resolve(extensionRoot)
    );

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        isBuiltin(specifier) ||
        (
          !specifier.startsWith("./") &&
          !specifier.startsWith("../") &&
          !specifier.startsWith("file:")
        )
      ) {
        throw new Error(
          `Extension import '${specifier}' is not allowed by the prototype worker policy.`
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
          `Extension import '${specifier}' did not resolve to a local file.`
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

      const relative = path.relative(
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
          `Extension import '${specifier}' escapes its extension root.`
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
          "Direct built-in module access is not allowed by the prototype worker policy."
        );
      },
      writable: false,
    }
  );
}

function installGlobalPolicy(): void {
  const denyNetwork = () => {
    throw new Error(
      "Direct network access is not allowed by the prototype worker policy."
    );
  };

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

  for (const name of [
    "_linkedBinding",
    "binding",
    "dlopen",
    "kill",
  ]) {
    if (name in process) {
      Object.defineProperty(
        process,
        name,
        {
          configurable: false,
          enumerable: false,
          value() {
            throw new Error(
              "Direct privileged process access is not allowed by the prototype worker policy."
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
    if (name in process) {
      Object.defineProperty(
        process,
        name,
        {
          configurable: false,
          enumerable: false,
          value() {
            throw new Error(
              "Direct IPC access is not allowed by the prototype worker policy."
            );
          },
          writable: false,
        }
      );
    }
  }

  for (const name of [
    "EventSource",
    "WebSocket",
  ]) {
    if (name in globalThis) {
      Object.defineProperty(
        globalThis,
        name,
        {
          configurable: false,
          enumerable: true,
          value: class {
            constructor() {
              denyNetwork();
            }
          },
          writable: false,
        }
      );
    }
  }
}

function isExtensionResponse(
  value: unknown
): value is ExtensionResponse {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const candidate = value as
    Partial<ExtensionResponse>;

  return (
    candidate.type === "response" &&
    typeof candidate.requestId ===
      "string" &&
    typeof candidate.ok === "boolean"
  );
}
