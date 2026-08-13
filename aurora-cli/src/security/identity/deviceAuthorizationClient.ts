import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

const DEVICE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code";

const DEFAULT_INTERVAL_SECONDS =
  5;

const SLOW_DOWN_SECONDS =
  5;

const DEFAULT_MAX_TOKEN_LIFETIME_SECONDS =
  60 * 60;

export interface DeviceAuthorization {
  readonly deviceCode: string;

  readonly userCode: string;

  readonly verificationUri: string;

  readonly expiresAt: string;

  readonly intervalSeconds: number;
}

export interface ShortLivedAccessToken {
  readonly accessToken: string;

  readonly tokenType: "Bearer";

  readonly expiresAt: string;

  readonly scope?: string;
}

export interface DeviceAuthorizationClientOptions {
  readonly deviceAuthorizationEndpoint:
    string;

  readonly tokenEndpoint: string;

  readonly clientId: string;

  readonly scope?:
    readonly string[];

  readonly fetchImplementation?:
    typeof fetch;

  readonly now?: () => number;

  readonly sleep?:
    (
      milliseconds: number,
      signal?: AbortSignal
    ) => Promise<void>;

  readonly maxTokenLifetimeSeconds?:
    number;
}

export class DeviceAuthorizationClient {
  private readonly options:
    Required<
      Pick<
        DeviceAuthorizationClientOptions,
        | "clientId"
        | "deviceAuthorizationEndpoint"
        | "tokenEndpoint"
      >
    > &
    DeviceAuthorizationClientOptions;

  private readonly fetchImplementation:
    typeof fetch;

  private readonly now:
    () => number;

  private readonly sleep:
    (
      milliseconds: number,
      signal?: AbortSignal
    ) => Promise<void>;

  private readonly maxTokenLifetimeSeconds:
    number;

  constructor(
    options:
      DeviceAuthorizationClientOptions
  ) {
    validateHttpsEndpoint(
      options.deviceAuthorizationEndpoint,
      "Device authorization endpoint"
    );

    validateHttpsEndpoint(
      options.tokenEndpoint,
      "Token endpoint"
    );

    validatePublicValue(
      options.clientId,
      "OAuth client identifier"
    );

    for (
      const scope
      of options.scope ?? []
    ) {
      validatePublicValue(
        scope,
        "OAuth scope"
      );
    }

    const maxTokenLifetimeSeconds =
      options.maxTokenLifetimeSeconds ??
      DEFAULT_MAX_TOKEN_LIFETIME_SECONDS;

    if (
      !Number.isSafeInteger(
        maxTokenLifetimeSeconds
      ) ||
      maxTokenLifetimeSeconds <= 0 ||
      maxTokenLifetimeSeconds > 24 * 60 * 60
    ) {
      throw deviceError(
        "Maximum access-token lifetime must be between 1 second and 24 hours."
      );
    }

    this.options = options;
    this.fetchImplementation =
      options.fetchImplementation ??
      fetch;
    this.now =
      options.now ?? Date.now;
    this.sleep =
      options.sleep ?? sleep;
    this.maxTokenLifetimeSeconds =
      maxTokenLifetimeSeconds;
  }

  async requestDeviceAuthorization(
    signal?: AbortSignal
  ): Promise<DeviceAuthorization> {
    const body =
      new URLSearchParams({
        client_id:
          this.options.clientId,
      });

    if (
      this.options.scope &&
      this.options.scope.length > 0
    ) {
      body.set(
        "scope",
        this.options.scope.join(" ")
      );
    }

    const response =
      await this.send(
        this.options
          .deviceAuthorizationEndpoint,
        body,
        signal
      );

    if (!response.ok) {
      throw deviceError(
        `Device authorization request failed with HTTP ${response.status}.`
      );
    }

    const payload =
      await readJsonObject(response);

    const deviceCode =
      requiredString(
        payload,
        "device_code"
      );

    const userCode =
      requiredString(
        payload,
        "user_code"
      );

    const verificationUri =
      requiredString(
        payload,
        "verification_uri"
      );

    validateHttpsEndpoint(
      verificationUri,
      "Verification URI"
    );

    const expiresIn =
      positiveInteger(
        payload,
        "expires_in"
      );

    const intervalSeconds =
      optionalPositiveInteger(
        payload,
        "interval"
      ) ??
      DEFAULT_INTERVAL_SECONDS;

    return {
      deviceCode,
      userCode,
      verificationUri,
      expiresAt:
        new Date(
          this.now() +
          expiresIn * 1000
        ).toISOString(),
      intervalSeconds,
    };
  }

  async pollForAccessToken(
    authorization:
      DeviceAuthorization,
    signal?: AbortSignal
  ): Promise<ShortLivedAccessToken> {
    const authorizationExpiry =
      Date.parse(
        authorization.expiresAt
      );

    if (
      !Number.isFinite(
        authorizationExpiry
      )
    ) {
      throw deviceError(
        "Device authorization expiry is invalid."
      );
    }

    let intervalSeconds =
      authorization.intervalSeconds;

    while (
      this.now() <
      authorizationExpiry
    ) {
      throwIfAborted(signal);

      const body =
        new URLSearchParams({
          grant_type:
            DEVICE_GRANT_TYPE,
          device_code:
            authorization.deviceCode,
          client_id:
            this.options.clientId,
        });

      const response =
        await this.send(
          this.options.tokenEndpoint,
          body,
          signal
        );

      const payload =
        await readJsonObject(response);

      if (response.ok) {
        return this.parseToken(
          payload
        );
      }

      const oauthError =
        typeof payload.error ===
          "string"
          ? payload.error
          : "unknown_error";

      if (
        oauthError ===
          "authorization_pending"
      ) {
        await this.sleep(
          intervalSeconds * 1000,
          signal
        );
        continue;
      }

      if (
        oauthError === "slow_down"
      ) {
        intervalSeconds +=
          SLOW_DOWN_SECONDS;

        await this.sleep(
          intervalSeconds * 1000,
          signal
        );
        continue;
      }

      if (
        oauthError ===
          "access_denied"
      ) {
        throw deviceError(
          "Device authorization was denied."
        );
      }

      if (
        oauthError ===
          "expired_token"
      ) {
        throw deviceError(
          "Device authorization expired before completion."
        );
      }

      throw deviceError(
        `Token request failed with OAuth error '${oauthError}'.`
      );
    }

    throw deviceError(
      "Device authorization expired before completion."
    );
  }

  private parseToken(
    payload: Record<string, unknown>
  ): ShortLivedAccessToken {
    if (
      payload.refresh_token !==
        undefined
    ) {
      throw deviceError(
        "Aurora Cloud identity responses must not issue refresh tokens."
      );
    }

    const accessToken =
      requiredString(
        payload,
        "access_token"
      );

    const tokenType =
      requiredString(
        payload,
        "token_type"
      );

    if (
      tokenType.toLowerCase() !==
        "bearer"
    ) {
      throw deviceError(
        "Aurora Cloud requires Bearer access tokens."
      );
    }

    const expiresIn =
      positiveInteger(
        payload,
        "expires_in"
      );

    if (
      expiresIn >
      this.maxTokenLifetimeSeconds
    ) {
      throw deviceError(
        `Access-token lifetime exceeds the ${this.maxTokenLifetimeSeconds} second security limit.`
      );
    }

    return {
      accessToken,
      tokenType: "Bearer",
      expiresAt:
        new Date(
          this.now() +
          expiresIn * 1000
        ).toISOString(),
      ...(typeof payload.scope ===
        "string"
        ? {
            scope: payload.scope,
          }
        : {}),
    };
  }

  private async send(
    endpoint: string,
    body: URLSearchParams,
    signal?: AbortSignal
  ): Promise<Response> {
    throwIfAborted(signal);

    try {
      return await this
        .fetchImplementation(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",
              Accept:
                "application/json",
            },
            body,
            redirect: "error",
            signal,
          }
        );
    } catch (error) {
      if (signal?.aborted) {
        throw deviceError(
          "Device authorization was cancelled.",
          error
        );
      }

      throw deviceError(
        "Aurora Cloud identity request could not be completed.",
        error
      );
    }
  }
}

async function readJsonObject(
  response: Response
): Promise<Record<string, unknown>> {
  let value: unknown;

  try {
    value = await response.json();
  } catch (error) {
    throw deviceError(
      "Identity endpoint returned invalid JSON.",
      error
    );
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw deviceError(
      "Identity endpoint returned an invalid response object."
    );
  }

  return value as
    Record<string, unknown>;
}

function requiredString(
  payload: Record<string, unknown>,
  field: string
): string {
  const value = payload[field];

  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0")
  ) {
    throw deviceError(
      `Identity response is missing valid '${field}'.`
    );
  }

  return value;
}

function positiveInteger(
  payload: Record<string, unknown>,
  field: string
): number {
  const value = payload[field];

  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0
  ) {
    throw deviceError(
      `Identity response is missing valid '${field}'.`
    );
  }

  return value as number;
}

function optionalPositiveInteger(
  payload: Record<string, unknown>,
  field: string
): number | undefined {
  if (payload[field] === undefined) {
    return undefined;
  }

  return positiveInteger(
    payload,
    field
  );
}

function validateHttpsEndpoint(
  value: string,
  label: string
): void {
  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch (error) {
    throw deviceError(
      `${label} must be a valid HTTPS URL.`,
      error
    );
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw deviceError(
      `${label} must be an HTTPS URL without credentials or a fragment.`
    );
  }
}

function validatePublicValue(
  value: string,
  label: string
): void {
  if (
    !value ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u
      .test(value)
  ) {
    throw deviceError(
      `${label} is invalid.`
    );
  }
}

function throwIfAborted(
  signal?: AbortSignal
): void {
  if (signal?.aborted) {
    throw deviceError(
      "Device authorization was cancelled."
    );
  }
}

function sleep(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      deviceError(
        "Device authorization was cancelled."
      )
    );
  }

  return new Promise(
    (resolve, reject) => {
      const complete = (): void => {
        signal?.removeEventListener(
          "abort",
          abort
        );
        resolve();
      };

      const abort = (): void => {
        clearTimeout(timeout);
        reject(
          deviceError(
            "Device authorization was cancelled."
          )
        );
      };

      const timeout = setTimeout(
        complete,
        milliseconds
      );

      signal?.addEventListener(
        "abort",
        abort,
        {
          once: true,
        }
      );
    }
  );
}

function deviceError(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    message,
    {
      code:
        ErrorCodes
          .DEVICE_AUTHORIZATION_FAILED,
      suggestion:
        "Retry Aurora Cloud device authorization using the official HTTPS endpoints.",
      cause,
    }
  );
}
