import type {
  CredentialStore,
} from "../credentials/credentialStore.js";

import type {
  SecretAccessContext,
} from "../credentials/secretAccessAuditLog.js";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  DeviceAuthorizationClient,
  type DeviceAuthorization,
  type ShortLivedAccessToken,
} from "./deviceAuthorizationClient.js";

const CLOUD_CREDENTIAL_ID =
  "aurora-cloud";

const EXPIRY_SKEW_MS =
  60_000;

const MAX_STORED_TOKEN_LIFETIME_MS =
  60 * 60 * 1000;

export interface CloudLoginOptions {
  readonly signal?: AbortSignal;

  readonly onVerification:
    (
      authorization: Readonly<
        Omit<
          DeviceAuthorization,
          "deviceCode"
        >
      >
    ) => void | Promise<void>;
}

export class CloudIdentityService {
  constructor(
    private readonly client:
      DeviceAuthorizationClient,
    private readonly credentialStore:
      CredentialStore,
    private readonly now:
      () => number = Date.now
  ) {}

  async login(
    options: CloudLoginOptions
  ): Promise<void> {
    const authorization =
      await this.client
        .requestDeviceAuthorization(
          options.signal
        );

    await options.onVerification({
      userCode:
        authorization.userCode,
      verificationUri:
        authorization.verificationUri,
      expiresAt:
        authorization.expiresAt,
      intervalSeconds:
        authorization.intervalSeconds,
    });

    const token =
      await this.client
        .pollForAccessToken(
          authorization,
          options.signal
        );

    await this.credentialStore.set(
      CLOUD_CREDENTIAL_ID,
      JSON.stringify(token),
      {
        scope: "local",
        purpose:
          "cloud-login",
      }
    );
  }

  async getAccessToken(
    context:
      SecretAccessContext = {
        scope: "local",
        purpose:
          "cloud-request",
      }
  ): Promise<string | null> {
    const stored =
      await this.credentialStore.get(
        CLOUD_CREDENTIAL_ID,
        context
      );

    if (!stored) {
      return null;
    }

    const token =
      parseStoredToken(stored);

    const expiresAt =
      Date.parse(token.expiresAt);

    if (
      expiresAt -
        EXPIRY_SKEW_MS <=
      this.now()
    ) {
      await this.credentialStore
        .delete(
          CLOUD_CREDENTIAL_ID,
          {
            ...context,
            purpose:
              "expired-token-cleanup",
          }
        );

      return null;
    }

    if (
      expiresAt - this.now() >
        MAX_STORED_TOKEN_LIFETIME_MS
    ) {
      throw storedIdentityError();
    }

    return token.accessToken;
  }

  async logout(): Promise<boolean> {
    return this.credentialStore.delete(
      CLOUD_CREDENTIAL_ID,
      {
        scope: "local",
        purpose:
          "cloud-logout",
      }
    );
  }
}

function parseStoredToken(
  value: string
): ShortLivedAccessToken {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw storedIdentityError(error);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw storedIdentityError();
  }

  const token = parsed as
    Partial<ShortLivedAccessToken>;

  if (
    typeof token.accessToken !==
      "string" ||
    !token.accessToken ||
    token.tokenType !== "Bearer" ||
    typeof token.expiresAt !==
      "string" ||
    !Number.isFinite(
      Date.parse(token.expiresAt)
    )
  ) {
    throw storedIdentityError();
  }

  return token as
    ShortLivedAccessToken;
}

function storedIdentityError(
  cause?: unknown
): AuroraError {
  return new AuroraError(
    "Stored Aurora Cloud identity is invalid or is not short-lived.",
    {
      code:
        ErrorCodes
          .CREDENTIAL_STORE_FAILED,
      suggestion:
        "Log out and repeat Aurora Cloud device authorization.",
      cause,
    }
  );
}
