export const REDACTED_VALUE =
  "[REDACTED]";

const SENSITIVE_KEY_PARTS = [
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "session",
  "setcookie",
  "token",
] as const;

const AUTHENTICATED_URL_PATTERN =
  /([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+)(?::[^\s/@]*)?@/giu;

const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|api[_-]?key|auth|credential|password|secret|signature|token)=)[^&#\s]*/giu;

const AUTHORIZATION_PATTERN =
  /((?:proxy-)?authorization\s*[:=]\s*)(?:bearer|basic)?\s*[^\s,;]+/giu;

const COOKIE_PATTERN =
  /((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/giu;

const JSON_SECRET_PATTERN =
  /("(?:accessToken|apiKey|authorization|clientSecret|cookie|credential|password|privateKey|refreshToken|secret|session|setCookie|token)"\s*:\s*)"(?:\\.|[^"\\])*"/giu;

const KEY_VALUE_SECRET_PATTERN =
  /\b((?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|session|set[_-]?cookie|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;

const WELL_KNOWN_TOKEN_PATTERN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gu;

export function isSensitiveKey(
  key: string
): boolean {
  const normalized =
    key.replace(
      /[^a-z0-9]/giu,
      ""
    ).toLowerCase();

  return SENSITIVE_KEY_PARTS.some(
    part =>
      normalized === part ||
      normalized.endsWith(part) ||
      normalized === `${part}s` ||
      normalized.endsWith(
        `${part}s`
      )
  );
}

export function redactText(
  value: string,
  explicitValues:
    readonly string[] = []
): string {
  let redacted = value
    .replace(
      AUTHENTICATED_URL_PATTERN,
      `$1${REDACTED_VALUE}@`
    )
    .replace(
      SENSITIVE_QUERY_PATTERN,
      `$1${REDACTED_VALUE}`
    )
    .replace(
      AUTHORIZATION_PATTERN,
      `$1${REDACTED_VALUE}`
    )
    .replace(
      COOKIE_PATTERN,
      `$1${REDACTED_VALUE}`
    )
    .replace(
      JSON_SECRET_PATTERN,
      `$1"${REDACTED_VALUE}"`
    )
    .replace(
      KEY_VALUE_SECRET_PATTERN,
      `$1${REDACTED_VALUE}`
    )
    .replace(
      WELL_KNOWN_TOKEN_PATTERN,
      REDACTED_VALUE
    );

  const orderedValues =
    Array.from(
      new Set(
        explicitValues.filter(
          explicitValue =>
            explicitValue.length > 0
        )
      )
    ).sort(
      (left, right) =>
        right.length - left.length
    );

  for (const explicitValue of orderedValues) {
    redacted = redacted
      .split(explicitValue)
      .join(REDACTED_VALUE);
  }

  return redacted;
}

export function redactSensitiveValue(
  value: unknown,
  explicitValues:
    readonly string[] = []
): unknown {
  return redactValue(
    value,
    explicitValues,
    new WeakSet<object>()
  );
}

function redactValue(
  value: unknown,
  explicitValues:
    readonly string[],
  visited: WeakSet<object>
): unknown {
  if (typeof value === "string") {
    return redactText(
      value,
      explicitValues
    );
  }

  if (
    value === null ||
    typeof value !== "object"
  ) {
    return value;
  }

  if (visited.has(value)) {
    return "[Circular]";
  }

  visited.add(value);

  if (Array.isArray(value)) {
    return value.map(
      item =>
        redactValue(
          item,
          explicitValues,
          visited
        )
    );
  }

  const redacted:
    Record<string, unknown> = {};

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    redacted[key] =
      isSensitiveKey(key)
        ? REDACTED_VALUE
        : redactValue(
            child,
            explicitValues,
            visited
          );
  }

  return redacted;
}
