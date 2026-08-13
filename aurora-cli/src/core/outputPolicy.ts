import {
  stripVTControlCharacters,
} from "node:util";

export interface CliOutputOptions {
  readonly color: boolean;

  readonly quiet: boolean;
}

export interface CliOutputPolicy {
  restore(): void;
}

type StreamWrite =
  typeof process.stdout.write;

export function resolveCliOutputOptions(
  argv: readonly string[]
): CliOutputOptions {
  let color = true;
  let quiet = false;

  for (
    const argument
    of argv.slice(2)
  ) {
    if (argument === "--") {
      break;
    }

    if (
      argument === "--quiet" ||
      argument === "-q"
    ) {
      quiet = true;
    }

    if (argument === "--no-color") {
      color = false;
    }
  }

  return {
    color,
    quiet,
  };
}

export function applyCliOutputPolicy(
  options: CliOutputOptions
): CliOutputPolicy {
  const stdoutWrite =
    process.stdout.write;
  const stderrWrite =
    process.stderr.write;

  process.stdout.write =
    createPolicyWrite(
      process.stdout,
      stdoutWrite,
      options.quiet,
      !options.color
    );

  process.stderr.write =
    createPolicyWrite(
      process.stderr,
      stderrWrite,
      false,
      !options.color
    );

  let restored = false;

  return {
    restore(): void {
      if (restored) {
        return;
      }

      restored = true;
      process.stdout.write =
        stdoutWrite;
      process.stderr.write =
        stderrWrite;
    },
  };
}

function createPolicyWrite(
  stream:
    NodeJS.WriteStream,
  write: StreamWrite,
  suppressed: boolean,
  stripColor: boolean
): StreamWrite {
  return function policyWrite(
    chunk: Uint8Array | string,
    encodingOrCallback?:
      BufferEncoding |
      ((error?: Error | null) => void),
    callback?:
      (error?: Error | null) => void
  ): boolean {
    const completion =
      typeof encodingOrCallback ===
      "function"
        ? encodingOrCallback
        : callback;

    if (suppressed) {
      completion?.(null);
      return true;
    }

    const output =
      stripColor
        ? removeColor(
            chunk,
            typeof encodingOrCallback ===
              "string"
              ? encodingOrCallback
              : undefined
          )
        : chunk;

    return Reflect.apply(
      write,
      stream,
      typeof encodingOrCallback ===
      "undefined"
        ? [output]
        : typeof callback ===
          "undefined"
          ? [
              output,
              encodingOrCallback,
            ]
          : [
              output,
              encodingOrCallback,
              callback,
            ]
    );
  } as StreamWrite;
}

function removeColor(
  chunk: Uint8Array | string,
  encoding?: BufferEncoding
): Uint8Array | string {
  if (typeof chunk === "string") {
    return stripVTControlCharacters(
      chunk
    );
  }

  const resolvedEncoding =
    encoding ?? "utf8";

  return Buffer.from(
    stripVTControlCharacters(
      Buffer.from(chunk).toString(
        resolvedEncoding
      )
    ),
    resolvedEncoding
  );
}
