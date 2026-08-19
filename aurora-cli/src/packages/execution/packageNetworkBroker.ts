import {
  lookup as dnsLookup,
} from "node:dns/promises";

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
  performance,
} from "node:perf_hooks";

import {
  TextDecoder,
} from "node:util";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import type {
  PackageCapabilityPolicy,
  PackageNetworkMethod,
} from "./packageCapabilityPolicy.js";

import {
  assertPublicPackageNetworkResolution,
} from "./packageNetworkAddressPolicy.js";

import type {
  PackageNetworkAddressFamily,
  PackageNetworkResolvedAddress,
} from "./packageNetworkAddressPolicy.js";

export const PACKAGE_NETWORK_URL_MAX_BYTES =
  8 * 1024;

export const PACKAGE_NETWORK_REQUEST_HEADERS_MAX =
  32;

export const PACKAGE_NETWORK_REQUEST_HEADER_VALUE_MAX_BYTES =
  8 * 1024;

export const PACKAGE_NETWORK_REQUEST_HEADERS_MAX_BYTES =
  16 * 1024;

export const PACKAGE_NETWORK_REQUEST_BODY_MAX_BYTES =
  256 * 1024;

export const PACKAGE_NETWORK_OUTBOUND_LIFECYCLE_MAX_BYTES =
  1024 * 1024;

export const PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES =
  1024 * 1024;

export const PACKAGE_NETWORK_INBOUND_LIFECYCLE_MAX_BYTES =
  4 * 1024 * 1024;

export const PACKAGE_NETWORK_REQUEST_MAX =
  32;

export const PACKAGE_NETWORK_CONCURRENCY_MAX =
  4;

export const PACKAGE_NETWORK_REQUEST_TIMEOUT_MS =
  10_000;

export const PACKAGE_NETWORK_RESPONSE_HEADERS_MAX =
  64;

export const PACKAGE_NETWORK_RESPONSE_HEADERS_MAX_BYTES =
  32 * 1024;

const HEADER_TOKEN_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

const NETWORK_METHODS =
  new Set<PackageNetworkMethod>([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ]);

const DENIED_REQUEST_HEADERS =
  new Set([
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authorization",
    "proxy-connection",
    "cookie",
    "accept-encoding",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "via",
  ]);

const FILTERED_RESPONSE_HEADERS =
  new Set([
    "set-cookie",
    "set-cookie2",
    "proxy-authenticate",
    "connection",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
  ]);

export type PackageNetworkManifest =
  Parameters<
    PackageCapabilityPolicy[
      "assertNetworkAccess"
    ]
  >[0];

export type PackageNetworkAccessPolicy =
  Pick<
    PackageCapabilityPolicy,
    "assertNetworkAccess"
  >;

export interface PackageNetworkRequest {
  readonly url: string;
  readonly method:
    PackageNetworkMethod;
  readonly headers?:
    Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface PackageNetworkResponseHeader {
  readonly name: string;
  readonly value: string;
}

export interface PackageNetworkResponse {
  readonly status: number;
  readonly headers:
    readonly PackageNetworkResponseHeader[];
  readonly body: string;
}

export interface PackageNetworkResolver {
  lookup(
    hostname: string
  ): Promise<
    readonly PackageNetworkResolvedAddress[]
  >;
}

export interface PackageNetworkTransportRequest {
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly method:
    PackageNetworkMethod;
  readonly headers:
    Readonly<Record<string, string>>;
  readonly body:
    Buffer | undefined;
  readonly address:
    PackageNetworkResolvedAddress;
  readonly timeoutMs: number;
  readonly onResponseHead:
    (
      status: number,
      headers:
        readonly PackageNetworkResponseHeader[]
    ) => void;
  readonly onBodyChunk:
    (chunk: Uint8Array) => void;
}

export interface PackageNetworkTransport {
  request(
    request:
      PackageNetworkTransportRequest
  ): Promise<void>;
}

export interface PackageNetworkBrokerOptions {
  readonly accessPolicy:
    PackageNetworkAccessPolicy;
  readonly resolver?:
    PackageNetworkResolver;
  readonly transport?:
    PackageNetworkTransport;
}

interface PreparedPackageNetworkRequest {
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly method:
    PackageNetworkMethod;
  readonly headers:
    Readonly<Record<string, string>>;
  readonly body:
    Buffer | undefined;
}

type PinnedLookupOptions =
  number |
  Readonly<{
    all?: boolean;
  }>;

type PinnedLookupCallback =
  (...args: unknown[]) => void;

const systemResolver:
  PackageNetworkResolver = {
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
  PackageNetworkTransport = {
    request(
      input:
        PackageNetworkTransportRequest
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
            };

          const fail =
            (error: unknown): void => {
              if (settled) {
                return;
              }

              settled = true;
              clearDeadline();
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
              method:
                input.method,
              headers:
                input.headers,
              family:
                input.address.family,
              servername:
                input.hostname,
              rejectUnauthorized: true,
              agent: false,
              maxHeaderSize:
                PACKAGE_NETWORK_RESPONSE_HEADERS_MAX_BYTES,
              lookup:
                pinnedLookup as unknown as
                  NonNullable<
                    HttpsRequestOptions[
                      "lookup"
                    ]
                  >,
            };

          try {
            outbound =
              httpsRequest(
                options,
                response => {
                  if (
                    typeof response.statusCode !==
                    "number"
                  ) {
                    response.resume();
                    fail(
                      new Error(
                        "HTTPS response omitted status code."
                      )
                    );
                    return;
                  }

                  const headers:
                    PackageNetworkResponseHeader[] = [];

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

                  try {
                    input.onResponseHead(
                      response.statusCode,
                      headers
                    );
                  } catch (error) {
                    response.destroy();
                    fail(error);
                    return;
                  }

                  let bodyFailure =
                    false;

                  response.on(
                    "data",
                    chunk => {
                      if (bodyFailure) {
                        return;
                      }

                      try {
                        input.onBodyChunk(
                          Buffer.isBuffer(chunk)
                            ? chunk
                            : Buffer.from(chunk)
                        );
                      } catch (error) {
                        bodyFailure = true;
                        response.destroy();
                        fail(error);
                      }
                    }
                  );

                  response.on(
                    "aborted",
                    () => {
                      if (!bodyFailure) {
                        fail(
                          new Error(
                            "HTTPS response was aborted."
                          )
                        );
                      }
                    }
                  );

                  response.on(
                    "error",
                    error => {
                      if (!bodyFailure) {
                        fail(error);
                      }
                    }
                  );

                  response.on(
                    "end",
                    () => {
                      if (!bodyFailure) {
                        succeed();
                      }
                    }
                  );
                }
              );
          } catch (error) {
            fail(error);
            return;
          }

          timeoutHandle =
            setTimeout(
              () => {
                if (settled) {
                  return;
                }

                const timeoutError =
                  new Error(
                    "Package HTTPS transport deadline expired."
                  ) as
                    NodeJS.ErrnoException;

                timeoutError.code =
                  "ETIMEDOUT";

                outbound?.destroy(
                  timeoutError
                );

                fail(timeoutError);
              },
              input.timeoutMs
            );

          outbound.on(
            "error",
            fail
          );

          if (input.body !== undefined) {
            outbound.write(
              input.body
            );
          }

          outbound.end();
        }
      );
    },
  };

export class PackageNetworkBroker {
  private readonly accessPolicy:
    PackageNetworkAccessPolicy;

  private readonly resolver:
    PackageNetworkResolver;

  private readonly transport:
    PackageNetworkTransport;

  constructor(
    options:
      PackageNetworkBrokerOptions
  ) {
    this.accessPolicy =
      options.accessPolicy;

    this.resolver =
      options.resolver ??
      systemResolver;

    this.transport =
      options.transport ??
      systemTransport;
  }

  createSession(
    manifest:
      PackageNetworkManifest
  ): PackageNetworkSession {
    return new PackageNetworkSession(
      manifest,
      this.accessPolicy,
      this.resolver,
      this.transport
    );
  }
}

export class PackageNetworkSession {
  private requestCount = 0;

  private activeRequests = 0;

  private outboundBytes = 0;

  private inboundBytes = 0;

  constructor(
    private readonly manifest:
      PackageNetworkManifest,
    private readonly accessPolicy:
      PackageNetworkAccessPolicy,
    private readonly resolver:
      PackageNetworkResolver,
    private readonly transport:
      PackageNetworkTransport
  ) {}

  async request(
    input:
      PackageNetworkRequest
  ): Promise<
    PackageNetworkResponse
  > {
    const deadline =
      performance.now() +
      PACKAGE_NETWORK_REQUEST_TIMEOUT_MS;

    if (
      this.requestCount >=
      PACKAGE_NETWORK_REQUEST_MAX
    ) {
      throw networkLimitError(
        this.manifest.id,
        "request-count lifecycle budget"
      );
    }

    if (
      this.activeRequests >=
      PACKAGE_NETWORK_CONCURRENCY_MAX
    ) {
      throw networkLimitError(
        this.manifest.id,
        "concurrent-request limit"
      );
    }

    const prepared =
      prepareNetworkRequest(
        this.manifest,
        this.accessPolicy,
        input
      );

    const requestBodyBytes =
      prepared.body?.byteLength ??
      0;

    if (
      this.outboundBytes +
        requestBodyBytes >
      PACKAGE_NETWORK_OUTBOUND_LIFECYCLE_MAX_BYTES
    ) {
      throw networkLimitError(
        this.manifest.id,
        "outbound-body lifecycle budget"
      );
    }

    this.requestCount += 1;
    this.activeRequests += 1;
    this.outboundBytes +=
      requestBodyBytes;

    let responseBytes = 0;

    const chunks: Buffer[] = [];

    let responseStatus:
      number | undefined;

    let responseHeaders:
      readonly PackageNetworkResponseHeader[] |
      undefined;

    try {
      let resolution:
        readonly PackageNetworkResolvedAddress[];

      try {
        resolution =
          await awaitWithinNetworkDeadline(
            this.resolver.lookup(
              prepared.hostname
            ),
            deadline,
            this.manifest.id
          );
      } catch (error) {
        if (error instanceof AuroraError) {
          throw error;
        }

        throw networkFailureError(
          this.manifest.id,
          "DNS resolution failed",
          error
        );
      }

      const validated =
        assertPublicPackageNetworkResolution(
          this.manifest.id,
          prepared.hostname,
          resolution
        );

      const pinned =
        validated[0];

      const remainingMs =
        remainingNetworkDeadlineMs(
          deadline,
          this.manifest.id
        );

      try {
        await awaitWithinNetworkDeadline(
          this.transport.request({
            hostname:
              prepared.hostname,
            port:
              prepared.port,
            path:
              prepared.path,
            method:
              prepared.method,
            headers:
              prepared.headers,
            body:
              prepared.body,
            address:
              pinned,
            timeoutMs:
              remainingMs,
            onResponseHead:
              (status, headers) => {
                if (
                  responseStatus !==
                  undefined
                ) {
                  throw networkFailureError(
                    this.manifest.id,
                    "HTTPS transport supplied more than one response head"
                  );
                }

                if (
                  !Number.isInteger(status) ||
                  status < 100 ||
                  status > 599
                ) {
                  throw networkFailureError(
                    this.manifest.id,
                    "HTTPS transport returned an invalid status code"
                  );
                }

                responseStatus =
                  status;

                responseHeaders =
                  sanitizeResponseHeaders(
                    this.manifest.id,
                    headers
                  );
              },
            onBodyChunk:
              chunk => {
                if (
                  responseStatus ===
                  undefined
                ) {
                  throw networkFailureError(
                    this.manifest.id,
                    "HTTPS transport released body bytes before the response head"
                  );
                }

                const bytes =
                  Buffer.from(chunk);

                responseBytes +=
                  bytes.byteLength;

                this.inboundBytes +=
                  bytes.byteLength;

                if (
                  responseBytes >
                  PACKAGE_NETWORK_RESPONSE_BODY_MAX_BYTES
                ) {
                  throw networkLimitError(
                    this.manifest.id,
                    "per-response body limit"
                  );
                }

                if (
                  this.inboundBytes >
                  PACKAGE_NETWORK_INBOUND_LIFECYCLE_MAX_BYTES
                ) {
                  throw networkLimitError(
                    this.manifest.id,
                    "inbound-body lifecycle budget"
                  );
                }

                chunks.push(bytes);
              },
          }),
          deadline,
          this.manifest.id
        );
      } catch (error) {
        if (error instanceof AuroraError) {
          throw error;
        }

        if (isTimeoutError(error)) {
          throw networkTimeoutError(
            this.manifest.id,
            error
          );
        }

        if (isHeaderOverflowError(error)) {
          throw networkLimitError(
            this.manifest.id,
            "response-header limit",
            error
          );
        }

        throw networkFailureError(
          this.manifest.id,
          "HTTPS transport failed",
          error
        );
      }

      if (
        responseStatus === undefined ||
        responseHeaders === undefined
      ) {
        throw networkFailureError(
          this.manifest.id,
          "HTTPS transport completed without a response head"
        );
      }

      const body =
        decodeResponseBody(
          this.manifest.id,
          chunks,
          responseBytes
        );

      return {
        status:
          responseStatus,
        headers:
          responseHeaders,
        body,
      };
    } finally {
      this.activeRequests -=
        1;
    }
  }
}

function prepareNetworkRequest(
  manifest:
    PackageNetworkManifest,
  accessPolicy:
    PackageNetworkAccessPolicy,
  input:
    PackageNetworkRequest
): PreparedPackageNetworkRequest {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      key =>
        ![
          "url",
          "method",
          "headers",
          "body",
        ].includes(key)
    ) ||
    typeof input.url !==
      "string" ||
    !isPackageNetworkMethod(
      input.method
    )
  ) {
    throw networkFailureError(
      manifest.id,
      "network request shape is invalid"
    );
  }

  if (
    input.url.length === 0 ||
    Buffer.byteLength(
      input.url,
      "utf8"
    ) >
      PACKAGE_NETWORK_URL_MAX_BYTES
  ) {
    throw networkLimitError(
      manifest.id,
      "request URL limit"
    );
  }

  let parsed: URL;

  try {
    parsed =
      new URL(input.url);
  } catch (error) {
    throw networkFailureError(
      manifest.id,
      "request URL is invalid",
      error
    );
  }

  if (parsed.protocol !== "https:") {
    throw networkPermissionError(
      manifest.id,
      "only HTTPS origins are permitted"
    );
  }

  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw networkPermissionError(
      manifest.id,
      "URL credentials are not permitted"
    );
  }

  if (parsed.hash.length > 0) {
    throw networkFailureError(
      manifest.id,
      "URL fragments are not permitted"
    );
  }

  const hostname =
    parsed.hostname;

  const ipCandidate =
    hostname.startsWith("[") &&
    hostname.endsWith("]")
      ? hostname.slice(
          1,
          -1
        )
      : hostname;

  if (
    hostname.length === 0 ||
    isIP(ipCandidate) !== 0
  ) {
    throw networkPermissionError(
      manifest.id,
      "IP-literal network targets are not permitted"
    );
  }

  accessPolicy.assertNetworkAccess(
    manifest,
    parsed.origin,
    input.method
  );

  const packageHeaders =
    validateRequestHeaders(
      manifest.id,
      input.headers
    );

  let body:
    Buffer | undefined;

  if (input.body !== undefined) {
    if (typeof input.body !== "string") {
      throw networkFailureError(
        manifest.id,
        "request body must be UTF-8 text"
      );
    }

    if (
      input.method === "GET" ||
      input.method === "HEAD"
    ) {
      throw networkFailureError(
        manifest.id,
        "GET and HEAD requests cannot contain a request body"
      );
    }

    body =
      Buffer.from(
        input.body,
        "utf8"
      );

    if (
      body.byteLength >
      PACKAGE_NETWORK_REQUEST_BODY_MAX_BYTES
    ) {
      throw networkLimitError(
        manifest.id,
        "per-request body limit"
      );
    }
  }

  const headers =
    Object.create(null) as
      Record<string, string>;

  for (
    const [name, value]
    of Object.entries(
      packageHeaders
    )
  ) {
    headers[name] = value;
  }

  headers["Accept-Encoding"] =
    "identity";

  if (body !== undefined) {
    headers["Content-Length"] =
      String(
        body.byteLength
      );
  }

  const port =
    parsed.port.length > 0
      ? Number(parsed.port)
      : 443;

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw networkFailureError(
      manifest.id,
      "request port is invalid"
    );
  }

  return {
    hostname,
    port,
    path:
      parsed.pathname +
      parsed.search,
    method:
      input.method,
    headers,
    body,
  };
}

function validateRequestHeaders(
  packageId: string,
  headers:
    Readonly<Record<string, string>> |
    undefined
): Readonly<Record<string, string>> {
  if (headers === undefined) {
    return {};
  }

  if (
    !isRecord(headers) ||
    Array.isArray(headers)
  ) {
    throw networkFailureError(
      packageId,
      "request headers are invalid"
    );
  }

  const entries =
    Object.entries(headers);

  if (
    entries.length >
    PACKAGE_NETWORK_REQUEST_HEADERS_MAX
  ) {
    throw networkLimitError(
      packageId,
      "request-header count limit"
    );
  }

  const seen =
    new Set<string>();

  const result =
    Object.create(null) as
      Record<string, string>;

  let aggregateBytes = 0;

  for (const [name, value] of entries) {
    const lowerName =
      name.toLowerCase();

    if (
      !HEADER_TOKEN_PATTERN.test(name) ||
      seen.has(lowerName)
    ) {
      throw networkFailureError(
        packageId,
        "request header name is invalid or duplicated"
      );
    }

    seen.add(lowerName);

    if (
      DENIED_REQUEST_HEADERS.has(
        lowerName
      )
    ) {
      throw networkPermissionError(
        packageId,
        `package-controlled header ${name} is not permitted`
      );
    }

    if (typeof value !== "string") {
      throw networkFailureError(
        packageId,
        "request header value must be a string"
      );
    }

    if (
      value.includes("\r") ||
      value.includes("\n") ||
      value.includes("\0")
    ) {
      throw networkFailureError(
        packageId,
        "request header value contains forbidden control characters"
      );
    }

    const valueBytes =
      Buffer.byteLength(
        value,
        "utf8"
      );

    if (
      valueBytes >
      PACKAGE_NETWORK_REQUEST_HEADER_VALUE_MAX_BYTES
    ) {
      throw networkLimitError(
        packageId,
        "individual request-header value limit"
      );
    }

    aggregateBytes +=
      Buffer.byteLength(
        name,
        "utf8"
      ) +
      valueBytes +
      4;

    if (
      aggregateBytes >
      PACKAGE_NETWORK_REQUEST_HEADERS_MAX_BYTES
    ) {
      throw networkLimitError(
        packageId,
        "aggregate request-header limit"
      );
    }

    result[name] = value;
  }

  return result;
}

function sanitizeResponseHeaders(
  packageId: string,
  headers:
    readonly PackageNetworkResponseHeader[]
): readonly PackageNetworkResponseHeader[] {
  if (!Array.isArray(headers)) {
    throw networkFailureError(
      packageId,
      "HTTPS response headers are invalid"
    );
  }

  if (
    headers.length >
    PACKAGE_NETWORK_RESPONSE_HEADERS_MAX
  ) {
    throw networkLimitError(
      packageId,
      "response-header count limit"
    );
  }

  let aggregateBytes = 0;

  const result:
    PackageNetworkResponseHeader[] = [];

  for (const header of headers) {
    if (
      !isRecord(header) ||
      typeof header.name !==
        "string" ||
      typeof header.value !==
        "string" ||
      !HEADER_TOKEN_PATTERN.test(
        header.name
      ) ||
      header.value.includes("\r") ||
      header.value.includes("\n") ||
      header.value.includes("\0")
    ) {
      throw networkFailureError(
        packageId,
        "HTTPS response header metadata is invalid"
      );
    }

    aggregateBytes +=
      Buffer.byteLength(
        header.name,
        "utf8"
      ) +
      Buffer.byteLength(
        header.value,
        "utf8"
      ) +
      4;

    if (
      aggregateBytes >
      PACKAGE_NETWORK_RESPONSE_HEADERS_MAX_BYTES
    ) {
      throw networkLimitError(
        packageId,
        "aggregate response-header limit"
      );
    }

    const lowerName =
      header.name.toLowerCase();

    if (
      lowerName ===
      "content-encoding" &&
      header.value.trim().toLowerCase() !==
        "identity"
    ) {
      throw networkFailureError(
        packageId,
        "compressed network responses are not supported"
      );
    }

    if (
      FILTERED_RESPONSE_HEADERS.has(
        lowerName
      )
    ) {
      continue;
    }

    result.push({
      name:
        header.name,
      value:
        header.value,
    });
  }

  return result;
}

function decodeResponseBody(
  packageId: string,
  chunks:
    readonly Buffer[],
  totalBytes: number
): string {
  const body =
    Buffer.concat(
      chunks,
      totalBytes
    );

  try {
    return new TextDecoder(
      "utf-8",
      { fatal: true }
    ).decode(body);
  } catch (error) {
    throw networkFailureError(
      packageId,
      "network response body is not valid UTF-8 text",
      error
    );
  }
}

async function awaitWithinNetworkDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  packageId: string
): Promise<T> {
  const remainingMs =
    remainingNetworkDeadlineMs(
      deadline,
      packageId
    );

  let timeoutHandle:
    NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>(
        (_resolve, reject) => {
          timeoutHandle =
            setTimeout(
              () => {
                reject(
                  networkTimeoutError(
                    packageId
                  )
                );
              },
              remainingMs
            );
        }
      ),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(
        timeoutHandle
      );
    }
  }
}

function remainingNetworkDeadlineMs(
  deadline: number,
  packageId: string
): number {
  const remaining =
    Math.ceil(
      deadline -
      performance.now()
    );

  if (remaining <= 0) {
    throw networkTimeoutError(
      packageId
    );
  }

  return Math.max(
    1,
    remaining
  );
}

function isPackageNetworkMethod(
  value: unknown
): value is
  PackageNetworkMethod {
  return (
    typeof value === "string" &&
    NETWORK_METHODS.has(
      value as
        PackageNetworkMethod
    )
  );
}

function isRecord(
  value: unknown
): value is
  Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isTimeoutError(
  error: unknown
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (
      (error as NodeJS.ErrnoException)
        .code === "ETIMEDOUT" ||
      (error as NodeJS.ErrnoException)
        .code === "ESOCKETTIMEDOUT"
    )
  );
}

function isHeaderOverflowError(
  error: unknown
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException)
      .code ===
        "HPE_HEADER_OVERFLOW"
  );
}

function networkPermissionError(
  packageId: string,
  reason: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' network request denied: ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PERMISSION_DENIED,
      suggestion:
        "Use only the exact HTTPS origin and method explicitly declared and granted to this package.",
    }
  );
}

function networkFailureError(
  packageId: string,
  reason: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' network request failed: ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_NETWORK_FAILED,
      suggestion:
        "Use a valid bounded HTTPS text request to an explicitly authorized public network origin.",
      cause,
    }
  );
}

function networkTimeoutError(
  packageId: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' network request exceeded the ${PACKAGE_NETWORK_REQUEST_TIMEOUT_MS} ms total deadline.`,
    {
      code:
        ErrorCodes
          .PACKAGE_NETWORK_TIMEOUT,
      suggestion:
        "Retry only when the explicitly authorized upstream can complete DNS and HTTPS within the package network deadline.",
      cause,
    }
  );
}

function networkLimitError(
  packageId: string,
  limit: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' exceeded the package network ${limit}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_NETWORK_LIMIT,
      suggestion:
        "Reduce package network request counts, concurrency, headers, or body sizes to remain within the bounded network broker limits.",
      cause,
    }
  );
}
