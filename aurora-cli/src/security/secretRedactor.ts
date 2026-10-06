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
  let redacted = redactAuthenticatedUrls(value)
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

/**
 * Search for authority delimiters first. A scheme-prefix regular expression can
 * retry at every letter of a long non-URL string and scan the remaining suffix
 * each time. Each scheme and authority scan stops at a neighboring delimiter
 * or boundary, so characters are inspected a bounded number of times.
 */
function redactAuthenticatedUrls(value: string): string {
  const parts: string[] = [];
  let searchFrom = 0;
  let copiedUntil = 0;
  while (searchFrom < value.length) {
    const delimiter = value.indexOf("://", searchFrom);
    if (delimiter === -1) break;
    searchFrom = delimiter + 3;

    let schemeStart = delimiter;
    while (schemeStart > copiedUntil && isSchemeCharacter(value.charCodeAt(schemeStart - 1))) {
      schemeStart--;
    }
    // The previous expression accepted the first scheme letter in this run,
    // including custom schemes preceded by punctuation or digits.
    while (schemeStart < delimiter && !isSchemeLetter(value.charCodeAt(schemeStart))) {
      schemeStart++;
    }
    if (schemeStart === delimiter) continue;

    const authorityStart = delimiter + 3;
    let authorityEnd = authorityStart;
    while (authorityEnd < value.length && value[authorityEnd] !== "@" &&
        value[authorityEnd] !== "/" && !/\s/u.test(value[authorityEnd]!)) {
      authorityEnd++;
    }
    // A nonempty username is required. A password may be empty or contain
    // additional colons; whitespace and slash terminate the authority.
    if (authorityEnd === authorityStart || value[authorityStart] === ":" ||
        value[authorityEnd] !== "@") continue;

    parts.push(value.slice(copiedUntil, authorityStart), `${REDACTED_VALUE}@`);
    copiedUntil = authorityEnd + 1;
    searchFrom = copiedUntil;
  }
  if (parts.length === 0) return value;
  parts.push(value.slice(copiedUntil));
  return parts.join("");
}

function isSchemeLetter(code: number): boolean {
  // Preserve the two additional characters matched by [a-z] under /iu.
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    code === 0x017f || code === 0x212a;
}

function isSchemeCharacter(code: number): boolean {
  return isSchemeLetter(code) || (code >= 48 && code <= 57) ||
    code === 43 || code === 45 || code === 46;
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
