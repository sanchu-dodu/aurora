import {
  createVerify,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

/*
 * AEGIS-003: Firebase ID token verification.
 *
 * Correcting an earlier assessment note: verifying an ID token requires only
 * Google's PUBLIC signing certificates and the (public) Firebase project ID.
 * A service-account credential is needed to MINT custom tokens or to call
 * privileged Admin APIs, not to verify one. Verification is therefore
 * implementable here without adding firebase-admin or provisioning a secret.
 *
 * Implemented directly against node:crypto to avoid expanding the
 * supply-chain surface for ~150 lines of well-specified logic.
 *
 * Reference: https://firebase.google.com/docs/auth/admin/verify-id-tokens
 * ("Verify ID tokens using a third-party JWT library")
 */

const GOOGLE_CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/*
 * Tolerance for clock drift between this server and Google's issuer.
 */
const CLOCK_SKEW_SECONDS = 60;

/*
 * Hard ceiling on token size. Parsing is cheap, but this stops a caller from
 * forcing large base64 decodes before any signature work happens.
 */
const MAX_TOKEN_BYTES = 8_192;

export interface VerifiedIdentity {
  readonly uid: string;
  readonly email?: string;
  readonly emailVerified: boolean;
}

export class IdTokenError extends Error {
  /*
   * Declared explicitly rather than as a TypeScript parameter property so
   * this module remains loadable under Node's native type stripping, which
   * the security regression tests rely on.
   */
  readonly reason: string;

  constructor(
    message: string,
    reason: string
  ) {
    super(message);
    this.name = "IdTokenError";
    this.reason = reason;
  }
}

export type PublicKeyResolver =
  () => Promise<ReadonlyMap<string, KeyObject>>;

interface CachedKeys {
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly expiresAt: number;
}

let cache: CachedKeys | null = null;

function parseMaxAge(
  header: string | null
): number {
  if (!header) {
    return 3_600;
  }

  const match = /max-age\s*=\s*(\d+)/i.exec(
    header
  );

  if (!match) {
    return 3_600;
  }

  const seconds = Number(match[1]);

  /*
   * Clamp so a hostile or misconfigured response cannot pin stale keys for
   * an unreasonable period, nor force constant refetching.
   */
  return Math.min(
    Math.max(seconds, 300),
    86_400
  );
}

/*
 * Default resolver: fetches Google's x509 certificates and converts each to a
 * public key, honouring the Cache-Control lifetime.
 */
export const fetchGooglePublicKeys: PublicKeyResolver =
  async () => {
    const now = Date.now();

    if (cache && cache.expiresAt > now) {
      return cache.keys;
    }

    const response = await fetch(
      GOOGLE_CERT_URL
    );

    if (!response.ok) {
      throw new IdTokenError(
        "Unable to retrieve Google signing certificates.",
        "key_fetch_failed"
      );
    }

    const payload = (await response.json()) as Record<
      string,
      string
    >;

    const keys = new Map<string, KeyObject>();

    for (const [kid, certificate] of Object.entries(
      payload
    )) {
      try {
        keys.set(
          kid,
          new X509Certificate(
            certificate
          ).publicKey
        );
      } catch {
        /*
         * Skip an unparseable certificate rather than failing the whole
         * refresh; the remaining keys are still usable.
         */
      }
    }

    if (keys.size === 0) {
      throw new IdTokenError(
        "Google returned no usable signing certificates.",
        "key_fetch_empty"
      );
    }

    cache = {
      keys,
      expiresAt:
        now +
        parseMaxAge(
          response.headers.get("cache-control")
        ) *
          1000,
    };

    return keys;
  };

function decodeSegment(
  segment: string,
  reason: string
): Record<string, unknown> {
  let decoded: string;

  try {
    decoded = Buffer.from(
      segment,
      "base64url"
    ).toString("utf8");
  } catch {
    throw new IdTokenError(
      "Token segment is not valid base64url.",
      reason
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new IdTokenError(
      "Token segment is not valid JSON.",
      reason
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new IdTokenError(
      "Token segment is not a JSON object.",
      reason
    );
  }

  return parsed as Record<string, unknown>;
}

export interface IdTokenVerifierOptions {
  readonly projectId: string;
  readonly resolver?: PublicKeyResolver;
  readonly now?: () => number;
}

export function createIdTokenVerifier(
  options: IdTokenVerifierOptions
) {
  const resolver =
    options.resolver ?? fetchGooglePublicKeys;

  const clock =
    options.now ??
    (() => Math.floor(Date.now() / 1000));

  const expectedIssuer = `https://securetoken.google.com/${options.projectId}`;

  return {
    async verify(
      token: string
    ): Promise<VerifiedIdentity> {
      if (
        !token ||
        Buffer.byteLength(token, "utf8") >
          MAX_TOKEN_BYTES
      ) {
        throw new IdTokenError(
          "Token is missing or oversized.",
          "malformed"
        );
      }

      const parts = token.split(".");

      if (parts.length !== 3) {
        throw new IdTokenError(
          "Token is not a well-formed JWT.",
          "malformed"
        );
      }

      const [
        headerSegment,
        payloadSegment,
        signatureSegment,
      ] = parts;

      const header = decodeSegment(
        headerSegment,
        "malformed_header"
      );

      /*
       * Algorithm is pinned. Accepting the token's own "alg" would permit
       * classic confusion attacks: "none" (no signature at all) or HS256
       * with the public key used as an HMAC secret.
       */
      if (header.alg !== "RS256") {
        throw new IdTokenError(
          "Token algorithm is not RS256.",
          "bad_algorithm"
        );
      }

      const kid = header.kid;

      if (
        typeof kid !== "string" ||
        kid.length === 0
      ) {
        throw new IdTokenError(
          "Token header has no key identifier.",
          "missing_kid"
        );
      }

      const keys = await resolver();

      const publicKey = keys.get(kid);

      if (!publicKey) {
        throw new IdTokenError(
          "Token was signed with an unknown key.",
          "unknown_kid"
        );
      }

      const signature = Buffer.from(
        signatureSegment,
        "base64url"
      );

      const verifier = createVerify("RSA-SHA256");

      verifier.update(
        `${headerSegment}.${payloadSegment}`
      );

      verifier.end();

      if (
        !verifier.verify(
          publicKey,
          signature
        )
      ) {
        throw new IdTokenError(
          "Token signature is invalid.",
          "bad_signature"
        );
      }

      const payload = decodeSegment(
        payloadSegment,
        "malformed_payload"
      );

      const now = clock();

      if (payload.iss !== expectedIssuer) {
        throw new IdTokenError(
          "Token issuer does not match this project.",
          "bad_issuer"
        );
      }

      if (payload.aud !== options.projectId) {
        throw new IdTokenError(
          "Token audience does not match this project.",
          "bad_audience"
        );
      }

      if (
        typeof payload.exp !== "number" ||
        payload.exp + CLOCK_SKEW_SECONDS <= now
      ) {
        throw new IdTokenError(
          "Token has expired.",
          "expired"
        );
      }

      if (
        typeof payload.iat !== "number" ||
        payload.iat - CLOCK_SKEW_SECONDS > now
      ) {
        throw new IdTokenError(
          "Token was issued in the future.",
          "bad_issued_at"
        );
      }

      if (
        typeof payload.auth_time === "number" &&
        payload.auth_time - CLOCK_SKEW_SECONDS >
          now
      ) {
        throw new IdTokenError(
          "Token authentication time is in the future.",
          "bad_auth_time"
        );
      }

      if (
        typeof payload.sub !== "string" ||
        payload.sub.length === 0 ||
        payload.sub.length > 128
      ) {
        throw new IdTokenError(
          "Token subject is missing or invalid.",
          "bad_subject"
        );
      }

      return {
        uid: payload.sub,
        email:
          typeof payload.email === "string"
            ? payload.email
            : undefined,
        emailVerified:
          payload.email_verified === true,
      };
    },
  };
}

/*
 * The Firebase project ID is public (it already ships in the client bundle
 * via app/lib/firebase.ts), so sourcing it from configuration exposes
 * nothing. It is env-overridable so non-production projects work unchanged.
 */
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ??
  "aurora-7b677";

let shared:
  | ReturnType<typeof createIdTokenVerifier>
  | null = null;

export function idTokenVerifier() {
  if (!shared) {
    shared = createIdTokenVerifier({
      projectId: PROJECT_ID,
    });
  }

  return shared;
}

/*
 * Extracts a bearer token, returning null when the caller is simply
 * anonymous (no header) rather than presenting a malformed credential.
 */
export type BearerResult =
  | { readonly kind: "absent" }
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "malformed" };

export function bearerToken(
  request: Request
): BearerResult {
  const header = request.headers.get(
    "authorization"
  );

  if (!header || !header.trim()) {
    return { kind: "absent" };
  }

  const trimmed = header.trim();

  /*
   * A non-bearer scheme (for example Basic) is not a credential this route
   * understands, so the caller is treated as anonymous rather than errored.
   */
  if (!/^Bearer\b/i.test(trimmed)) {
    return { kind: "absent" };
  }

  const match = /^Bearer\s+(\S.*)$/i.exec(
    trimmed
  );

  /*
   * "Bearer" with an empty or whitespace-only value IS a presented
   * credential, just an invalid one. Treating it as anonymous would let a
   * caller probe the boundary without generating an auth failure signal.
   */
  if (!match) {
    return { kind: "malformed" };
  }

  return {
    kind: "token",
    token: match[1].trim(),
  };
}
