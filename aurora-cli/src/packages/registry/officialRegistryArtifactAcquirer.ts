import {
  createHash,
} from "node:crypto";

import {
  lookup as dnsLookup,
} from "node:dns/promises";

import fs from "node:fs/promises";

import type {
  IncomingMessage,
} from "node:http";

import {
  request as httpsRequest,
} from "node:https";

import type {
  RequestOptions as HttpsRequestOptions,
} from "node:https";

import {
  isIP,
} from "node:net";

import {
  tmpdir,
} from "node:os";

import {
  join,
  resolve,
} from "node:path";

import {
  performance,
} from "node:perf_hooks";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  redactText,
} from "../../security/secretRedactor.js";

import {
  isPublicPackageNetworkAddress,
} from "../execution/packageNetworkAddressPolicy.js";

import type {
  PackageNetworkAddressFamily,
  PackageNetworkResolvedAddress,
} from "../execution/packageNetworkAddressPolicy.js";

import type {
  OfficialRegistryCatalogOptions,
} from "./officialRegistryCatalog.js";

import {
  OfficialRegistryResolver,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryVersionSelector,
  ResolvedOfficialRegistryPackage,
} from "./officialRegistryResolver.js";

export const OFFICIAL_REGISTRY_ARTIFACT_MAX_BYTES =
  256 * 1024 * 1024;

export const OFFICIAL_REGISTRY_ARTIFACT_TIMEOUT_MS =
  30_000;

export const OFFICIAL_REGISTRY_ARTIFACT_TIMEOUT_MAX_MS =
  120_000;

export const OFFICIAL_REGISTRY_ARTIFACT_RESPONSE_HEADERS_MAX =
  64;

export const OFFICIAL_REGISTRY_ARTIFACT_RESPONSE_HEADERS_MAX_BYTES =
  32 * 1024;

const HEADER_TOKEN_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

const verifiedArtifacts =
  new WeakSet<object>();

const LATEST_SELECTOR =
  Object.freeze({
    kind:
      "latest",
  } as const);

export interface OfficialRegistryArtifactResponseHeader {
  readonly name: string;
  readonly value: string;
}

export interface OfficialRegistryArtifactAddressResolver {
  lookup(
    hostname: string
  ): Promise<
    readonly PackageNetworkResolvedAddress[]
  >;
}

export interface OfficialRegistryArtifactTransportRequest {
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly address:
    PackageNetworkResolvedAddress;
  readonly timeoutMs: number;
  readonly signal:
    AbortSignal;
  readonly onResponseHead:
    (
      status: number,
      headers:
        readonly OfficialRegistryArtifactResponseHeader[]
    ) => void;
  readonly onBodyChunk:
    (chunk: Uint8Array) => Promise<void>;
}

export interface OfficialRegistryArtifactTransport {
  request(
    request:
      OfficialRegistryArtifactTransportRequest
  ): Promise<void>;
}

export interface OfficialRegistryArtifactAcquirerOptions {
  readonly registryOptions?:
    OfficialRegistryCatalogOptions;
  readonly addressResolver?:
    OfficialRegistryArtifactAddressResolver;
  readonly transport?:
    OfficialRegistryArtifactTransport;
  readonly quarantineRoot?: string;
  readonly maxArchiveBytes?: number;
  readonly timeoutMs?: number;
}

export interface VerifiedOfficialRegistryArtifact {
  readonly resolved:
    ResolvedOfficialRegistryPackage;
  readonly filePath: string;
  readonly quarantineDirectory: string;
  readonly receivedBytes: number;
}

type PinnedLookupOptions =
  number |
  Readonly<{
    all?: boolean;
  }>;

type PinnedLookupCallback =
  (...args: unknown[]) => void;

const systemAddressResolver:
  OfficialRegistryArtifactAddressResolver = {
    async lookup(
      hostname: string
    ): Promise<
      readonly PackageNetworkResolvedAddress[]
    > {
      const addresses =
        await dnsLookup(
          hostname,
          {
            all: true,
            order: "verbatim",
          }
        );

      return addresses.map(
        candidate => ({
          address:
            candidate.address,
          family:
            candidate.family as
              PackageNetworkAddressFamily,
        })
      );
    },
  };

const systemTransport:
  OfficialRegistryArtifactTransport = {
    request(
      input:
        OfficialRegistryArtifactTransportRequest
    ): Promise<void> {
      return new Promise(
        (resolve, reject) => {
          let settled = false;
          let timeoutHandle:
            NodeJS.Timeout | undefined;

          let outbound:
            ReturnType<
              typeof httpsRequest
            > | undefined;

          let inbound:
            IncomingMessage | undefined;

          const clearDeadline =
            (): void => {
              if (
                timeoutHandle !==
                  undefined
              ) {
                clearTimeout(
                  timeoutHandle
                );

                timeoutHandle =
                  undefined;
              }

              input.signal
                .removeEventListener(
                  "abort",
                  abortRequest
                );
            };

          const abortRequest =
            (): void => {
              const error =
                new Error(
                  "Official registry artifact HTTPS operation was aborted at its deadline."
                ) as
                  NodeJS.ErrnoException;

              error.code =
                "ETIMEDOUT";

              fail(error);
            };

          const fail =
            (error: unknown): void => {
              if (settled) {
                return;
              }

              settled = true;
              clearDeadline();
              inbound?.destroy();
              outbound?.destroy();
              reject(error);
            };

          const succeed =
            (): void => {
              if (settled) {
                return;
              }

              settled = true;
              clearDeadline();
              resolve();
            };

          const pinnedLookup =
            (
              _hostname: string,
              options:
                PinnedLookupOptions,
              callback:
                PinnedLookupCallback
            ): void => {
              const wantsAll =
                typeof options ===
                  "object" &&
                options !== null &&
                options.all === true;

              if (wantsAll) {
                callback(
                  null,
                  [
                    {
                      address:
                        input.address
                          .address,
                      family:
                        input.address
                          .family,
                    },
                  ]
                );

                return;
              }

              callback(
                null,
                input.address.address,
                input.address.family
              );
            };

          const options:
            HttpsRequestOptions = {
              protocol: "https:",
              hostname:
                input.hostname,
              port:
                input.port,
              path:
                input.path,
              method: "GET",
              headers: {
                accept:
                  "application/octet-stream",
                "accept-encoding":
                  "identity",
              },
              family:
                input.address.family,
              servername:
                isIP(
                  input.hostname
                ) === 0
                  ? input.hostname
                  : undefined,
              rejectUnauthorized: true,
              agent: false,
              maxHeaderSize:
                OFFICIAL_REGISTRY_ARTIFACT_RESPONSE_HEADERS_MAX_BYTES,
              lookup:
                pinnedLookup as unknown as
                  NonNullable<
                    HttpsRequestOptions[
                      "lookup"
                    ]
                  >,
            };

          if (
            input.signal.aborted
          ) {
            abortRequest();
            return;
          }

          input.signal
            .addEventListener(
              "abort",
              abortRequest,
              {
                once: true,
              }
            );

          try {
            outbound =
              httpsRequest(
                options,
                response => {
                  inbound =
                    response;

                  void (
                    async (): Promise<void> => {
                      if (
                        typeof response.statusCode !==
                          "number"
                      ) {
                        throw new Error(
                          "HTTPS response omitted status code."
                        );
                      }

                      const headers:
                        OfficialRegistryArtifactResponseHeader[] = [];

                      for (
                        let index = 0;
                        index + 1 <
                          response.rawHeaders.length;
                        index += 2
                      ) {
                        headers.push({
                          name:
                            response.rawHeaders[
                              index
                            ],
                          value:
                            response.rawHeaders[
                              index + 1
                            ],
                        });
                      }

                      input.onResponseHead(
                        response.statusCode,
                        headers
                      );

                      for await (
                        const chunk
                        of response
                      ) {
                        await input
                          .onBodyChunk(
                            Buffer.isBuffer(
                              chunk
                            )
                              ? chunk
                              : Buffer.from(
                                  chunk
                                )
                          );
                      }

                      succeed();
                    }
                  )().catch(
                    fail
                  );
                }
              );
          }
          catch (error) {
            fail(error);
            return;
          }

          timeoutHandle =
            setTimeout(
              () => {
                const error =
                  new Error(
                    "Official registry artifact HTTPS deadline expired."
                  ) as
                    NodeJS.ErrnoException;

                error.code =
                  "ETIMEDOUT";

                fail(error);
              },
              input.timeoutMs
            );

          outbound.on(
            "error",
            fail
          );

          outbound.end();
        }
      );
    },
  };

function acquisitionFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' acquisition failed: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_ACQUISITION_FAILED,
      suggestion:
        "Retry from an ordinary public HTTPS origin or select another verified official package version.",
      cause,
    }
  );
}

function acquisitionTimeout(
  packageId: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' acquisition exceeded its total deadline.`,
    {
      code:
        ErrorCodes
          .PACKAGE_ACQUISITION_TIMEOUT,
      suggestion:
        "Retry when the verified official artifact origin is responsive.",
      cause,
    }
  );
}

function acquisitionLimit(
  packageId: string,
  message: string
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' acquisition exceeded the ${message}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_ACQUISITION_LIMIT,
      suggestion:
        "Use an official package archive within Aurora's bounded acquisition policy.",
    }
  );
}

function acquisitionIntegrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' failed acquired-archive verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Discard the quarantined download and retry from the signed official registry URL.",
      cause,
    }
  );
}

function isTimeoutError(
  error: unknown
): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ETIMEDOUT"
  );
}

function normalizeUrlHostname(
  hostname: string
): string {
  if (
    hostname.startsWith("[") &&
    hostname.endsWith("]")
  ) {
    return hostname.slice(
      1,
      -1
    );
  }

  return hostname;
}

function assertSafeResolution(
  packageId: string,
  hostname: string,
  addresses:
    readonly PackageNetworkResolvedAddress[]
): readonly PackageNetworkResolvedAddress[] {
  if (addresses.length === 0) {
    throw acquisitionFailure(
      packageId,
      `host '${hostname}' resolved to no addresses.`
    );
  }

  const validated:
    PackageNetworkResolvedAddress[] = [];

  for (const candidate of addresses) {
    const actualFamily =
      isIP(
        candidate.address
      );

    if (
      (
        candidate.family !== 4 &&
        candidate.family !== 6
      ) ||
      actualFamily !==
        candidate.family ||
      !isPublicPackageNetworkAddress(
        candidate.address
      )
    ) {
      throw acquisitionFailure(
        packageId,
        `host '${hostname}' resolved to an unsafe or invalid address.`
      );
    }

    validated.push(
      Object.freeze({
        address:
          candidate.address,
        family:
          candidate.family,
      })
    );
  }

  return Object.freeze(
    validated
  );
}

function assertResponseHead(
  packageId: string,
  expectedBytes: number,
  status: number,
  headers:
    readonly OfficialRegistryArtifactResponseHeader[]
): void {
  if (
    !Number.isInteger(status) ||
    status !== 200
  ) {
    throw acquisitionFailure(
      packageId,
      status >= 300 &&
        status < 400
        ? "the signed artifact URL attempted an HTTP redirect."
        : `the artifact origin returned HTTP status ${status}.`
    );
  }

  if (
    headers.length >
      OFFICIAL_REGISTRY_ARTIFACT_RESPONSE_HEADERS_MAX
  ) {
    throw acquisitionLimit(
      packageId,
      "response-header count limit"
    );
  }

  let headerBytes = 0;
  const contentLengths:
    string[] = [];
  const contentEncodings:
    string[] = [];

  for (const header of headers) {
    if (
      typeof header.name !==
        "string" ||
      !HEADER_TOKEN_PATTERN.test(
        header.name
      ) ||
      typeof header.value !==
        "string" ||
      header.value.includes("\r") ||
      header.value.includes("\n")
    ) {
      throw acquisitionFailure(
        packageId,
        "the artifact origin returned malformed response headers."
      );
    }

    headerBytes +=
      Buffer.byteLength(
        header.name
      ) +
      Buffer.byteLength(
        header.value
      ) +
      4;

    const normalizedName =
      header.name.toLowerCase();

    if (
      normalizedName ===
        "content-length"
    ) {
      contentLengths.push(
        header.value
      );
    }

    if (
      normalizedName ===
        "content-encoding"
    ) {
      contentEncodings.push(
        header.value
          .trim()
          .toLowerCase()
      );
    }
  }

  if (
    headerBytes >
      OFFICIAL_REGISTRY_ARTIFACT_RESPONSE_HEADERS_MAX_BYTES
  ) {
    throw acquisitionLimit(
      packageId,
      "response-header byte limit"
    );
  }

  if (
    contentEncodings.length > 1 ||
    (
      contentEncodings.length === 1 &&
      contentEncodings[0] !==
        "identity"
    )
  ) {
    throw acquisitionFailure(
      packageId,
      "the artifact origin returned a transformed content encoding."
    );
  }

  if (contentLengths.length > 1) {
    throw acquisitionFailure(
      packageId,
      "the artifact origin returned ambiguous content lengths."
    );
  }

  if (
    contentLengths.length === 1
  ) {
    const value =
      contentLengths[0];

    if (
      !/^(0|[1-9][0-9]*)$/u.test(
        value
      ) ||
      Number(value) !==
        expectedBytes
    ) {
      throw acquisitionIntegrityFailure(
        packageId,
        "the response Content-Length does not match the signed archive size."
      );
    }
  }
}

function remainingDeadlineMs(
  deadline: number
): number {
  return Math.max(
    1,
    Math.ceil(
      deadline -
        performance.now()
    )
  );
}

async function withinDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle:
    NodeJS.Timeout | undefined;

  const timeout =
    new Promise<never>(
      (_resolve, reject) => {
        timeoutHandle =
          setTimeout(
            () => {
              const error =
                new Error(
                  "Official registry artifact operation deadline expired."
                ) as
                  NodeJS.ErrnoException;

              error.code =
                "ETIMEDOUT";
              reject(error);
            },
            timeoutMs
          );
      }
    );

  try {
    return await Promise.race([
      operation,
      timeout,
    ]);
  }
  finally {
    if (
      timeoutHandle !==
        undefined
    ) {
      clearTimeout(
        timeoutHandle
      );
    }
  }
}

async function writeAll(
  handle: fs.FileHandle,
  chunk: Buffer
): Promise<void> {
  let offset = 0;

  while (
    offset < chunk.byteLength
  ) {
    const result =
      await handle.write(
        chunk,
        offset,
        chunk.byteLength -
          offset,
        null
      );

    if (result.bytesWritten <= 0) {
      throw new Error(
        "Quarantine file write made no progress."
      );
    }

    offset +=
      result.bytesWritten;
  }
}

function createReceipt(
  resolved:
    ResolvedOfficialRegistryPackage,
  filePath: string,
  quarantineDirectory: string,
  receivedBytes: number
): VerifiedOfficialRegistryArtifact {
  const receipt:
    VerifiedOfficialRegistryArtifact =
      Object.freeze({
        resolved,
        filePath,
        quarantineDirectory,
        receivedBytes,
      });

  verifiedArtifacts.add(
    receipt
  );

  return receipt;
}

export function assertVerifiedOfficialRegistryArtifact(
  value: unknown
): asserts value is
  VerifiedOfficialRegistryArtifact {
  if (
    typeof value !==
      "object" ||
    value === null ||
    !verifiedArtifacts.has(
      value
    )
  ) {
    throw new TypeError(
      "Expected an authentic verified official registry artifact receipt."
    );
  }
}

export class OfficialRegistryArtifactAcquirer {
  private readonly registryResolver:
    OfficialRegistryResolver;

  private readonly addressResolver:
    OfficialRegistryArtifactAddressResolver;

  private readonly transport:
    OfficialRegistryArtifactTransport;

  private readonly quarantineRoot:
    string;

  private readonly maxArchiveBytes:
    number;

  private readonly timeoutMs:
    number;

  constructor(
    value: unknown,
    options:
      OfficialRegistryArtifactAcquirerOptions = {}
  ) {
    this.registryResolver =
      new OfficialRegistryResolver(
        value,
        options.registryOptions
      );

    this.addressResolver =
      options.addressResolver ??
      systemAddressResolver;

    this.transport =
      options.transport ??
      systemTransport;

    this.quarantineRoot =
      resolve(
        options.quarantineRoot ??
        tmpdir()
      );

    this.maxArchiveBytes =
      options.maxArchiveBytes ??
      OFFICIAL_REGISTRY_ARTIFACT_MAX_BYTES;

    this.timeoutMs =
      options.timeoutMs ??
      OFFICIAL_REGISTRY_ARTIFACT_TIMEOUT_MS;

    if (
      !Number.isSafeInteger(
        this.maxArchiveBytes
      ) ||
      this.maxArchiveBytes <= 0 ||
      this.maxArchiveBytes >
        OFFICIAL_REGISTRY_ARTIFACT_MAX_BYTES
    ) {
      throw new TypeError(
        "Official registry artifact maxArchiveBytes must be a positive safe integer no greater than Aurora's absolute archive limit."
      );
    }

    if (
      !Number.isSafeInteger(
        this.timeoutMs
      ) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs >
        OFFICIAL_REGISTRY_ARTIFACT_TIMEOUT_MAX_MS
    ) {
      throw new TypeError(
        "Official registry artifact timeoutMs must be a positive safe integer within Aurora's acquisition deadline limit."
      );
    }

    Object.freeze(
      this
    );
  }

  async acquire(
    packageId: string,
    selector:
      OfficialRegistryVersionSelector =
        LATEST_SELECTOR
  ): Promise<
    VerifiedOfficialRegistryArtifact
  > {
    const resolved =
      this.registryResolver.resolve(
        packageId,
        selector
      );

    const archive =
      resolved.entry.archive;

    if (
      archive.size >
        this.maxArchiveBytes
    ) {
      throw acquisitionLimit(
        packageId,
        "archive-size limit"
      );
    }

    const parsedUrl =
      new URL(
        archive.url
      );

    const hostname =
      normalizeUrlHostname(
        parsedUrl.hostname
      );

    const literalFamily =
      isIP(hostname);

    const deadline =
      performance.now() +
      this.timeoutMs;

    let quarantineDirectory:
      string | undefined;

    let handle:
      fs.FileHandle | undefined;

    try {
      const candidates =
        literalFamily === 4 ||
        literalFamily === 6
          ? [
              {
                address:
                  hostname,
                family:
                  literalFamily as
                    PackageNetworkAddressFamily,
              },
            ]
          : await withinDeadline(
              this.addressResolver
                .lookup(
                  hostname
                ),
              remainingDeadlineMs(
                deadline
              )
            );

      const addresses =
        assertSafeResolution(
          packageId,
          hostname,
          candidates
        );

      quarantineDirectory =
        await fs.mkdtemp(
          join(
            this.quarantineRoot,
            "aurora-official-package-"
          )
        );

      const filePath =
        join(
          quarantineDirectory,
          "archive.bin"
        );

      handle =
        await fs.open(
          filePath,
          "wx",
          0o600
        );

      const digest =
        createHash(
          "sha256"
        );

      let receivedBytes = 0;
      let sawResponseHead =
        false;

      let bodyFailure:
        unknown;

      let bodyQueue:
        Promise<void> =
          Promise.resolve();

      const transportAbort =
        new AbortController();

      try {
        await withinDeadline(
          this.transport.request({
            hostname,
            port:
              parsedUrl.port.length > 0
                ? Number(
                    parsedUrl.port
                  )
                : 443,
            path:
              `${parsedUrl.pathname}${parsedUrl.search}`,
            address:
              addresses[0],
            timeoutMs:
              remainingDeadlineMs(
                deadline
              ),
            signal:
              transportAbort.signal,
            onResponseHead:
              (
                status,
                headers
              ): void => {
                if (sawResponseHead) {
                  throw acquisitionFailure(
                    packageId,
                    "the artifact transport returned multiple response heads."
                  );
                }

                sawResponseHead =
                  true;

                assertResponseHead(
                  packageId,
                  archive.size,
                  status,
                  headers
                );
              },
            onBodyChunk:
              (
                input
              ): Promise<void> => {
                if (!sawResponseHead) {
                  throw acquisitionFailure(
                    packageId,
                    "the artifact transport returned bytes before a response head."
                  );
                }

                const chunk =
                  Buffer.from(
                    input
                  );

                const queued =
                  bodyQueue.then(
                    async (): Promise<void> => {
                      if (
                        bodyFailure !==
                          undefined
                      ) {
                        throw bodyFailure;
                      }

                      if (
                        receivedBytes +
                          chunk.byteLength >
                        archive.size
                      ) {
                        throw acquisitionIntegrityFailure(
                          packageId,
                          "the response exceeded the signed archive size."
                        );
                      }

                      if (
                        receivedBytes +
                          chunk.byteLength >
                        this.maxArchiveBytes
                      ) {
                        throw acquisitionLimit(
                          packageId,
                          "archive-byte limit"
                        );
                      }

                      await writeAll(
                        handle as fs.FileHandle,
                        chunk
                      );

                      digest.update(
                        chunk
                      );

                      receivedBytes +=
                        chunk.byteLength;
                    }
                  );

                bodyQueue =
                  queued.catch(
                    error => {
                      bodyFailure ??=
                        error;
                    }
                  );

                return queued;
              },
          }),
          remainingDeadlineMs(
            deadline
          )
        );

        await bodyQueue;

        if (
          bodyFailure !==
            undefined
        ) {
          throw bodyFailure;
        }
      }
      finally {
        transportAbort.abort();
      }

      if (!sawResponseHead) {
        throw acquisitionFailure(
          packageId,
          "the artifact transport returned no response head."
        );
      }

      if (
        receivedBytes !==
          archive.size
      ) {
        throw acquisitionIntegrityFailure(
          packageId,
          "the received byte count does not match the signed archive size."
        );
      }

      const actualDigest =
        digest.digest(
          "hex"
        );

      if (
        actualDigest !==
          archive.digest
      ) {
        throw acquisitionIntegrityFailure(
          packageId,
          "the received SHA-256 digest does not match the signed archive digest."
        );
      }

      await handle.sync();
      await handle.close();
      handle = undefined;

      return createReceipt(
        resolved,
        filePath,
        quarantineDirectory,
        receivedBytes
      );
    }
    catch (error) {
      let cleanupFailure:
        unknown;

      if (handle !== undefined) {
        try {
          await handle.close();
        }
        catch (closeError) {
          cleanupFailure =
            closeError;
        }
      }

      if (
        quarantineDirectory !==
          undefined
      ) {
        try {
          await fs.rm(
            quarantineDirectory,
            {
              recursive: true,
              force: true,
            }
          );
        }
        catch (removeError) {
          cleanupFailure =
            cleanupFailure ??
            removeError;
        }
      }

      if (
        cleanupFailure !==
          undefined
      ) {
        throw acquisitionFailure(
          packageId,
          "incomplete quarantine data could not be removed safely.",
          new AggregateError([
            error,
            cleanupFailure,
          ])
        );
      }

      if (error instanceof AuroraError) {
        throw error;
      }

      if (
        isTimeoutError(
          error
        )
      ) {
        throw acquisitionTimeout(
          packageId,
          error
        );
      }

      throw acquisitionFailure(
        packageId,
        error instanceof Error
          ? redactText(
              error.message
            )
          : "an unknown acquisition error occurred.",
        error
      );
    }
  }
}
