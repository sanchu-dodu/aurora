/*
 * AEGIS-008: server-side security event logging.
 *
 * Before this existed, exploitation attempts against the API routes left no
 * audit trail at all: a rejected traversal attempt and a normal request were
 * indistinguishable after the fact. This emits structured, single-line JSON
 * events to stdout so any log pipeline (Vercel, CloudWatch, Loki, Datadog)
 * can ingest, alert, and retain them.
 *
 * Design constraints, deliberately:
 *
 *   - Never log secrets. Values pass through a redactor modelled on the
 *     patterns already proven in aurora-cli/src/security/secretRedactor.ts.
 *   - Never log a full request URL (it may carry a credential in the query).
 *   - Never log raw request bodies or prompt content.
 *   - Client IPs are truncated, not stored whole, to limit the privacy
 *     footprint of security telemetry.
 *   - Logging must never break a request: every call is failure-tolerant.
 *
 * NIST CSF: DE.AE-3, DE.CM-1. CIS Control 8 (Audit Log Management).
 */

export type SecurityEvent =
  | "input_validation_failed"
  | "rate_limit_exceeded"
  | "upstream_failure"
  | "malformed_request";

export type SecurityOutcome =
  | "blocked"
  | "error";

export interface SecurityLogEntry {
  readonly event: SecurityEvent;
  readonly route: string;
  readonly outcome: SecurityOutcome;
  readonly reason?: string;
  readonly detail?: string;
  readonly finding?: string;
}

const REDACTED = "[REDACTED]";

/*
 * Mirrors the redaction families used by the Aurora CLI so that web and CLI
 * logs are consistently scrubbed.
 */
const AUTHENTICATED_URL_PATTERN =
  /([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+)(?::[^\s/@]*)?@/giu;

const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|api[_-]?key|auth|credential|password|secret|signature|token)=)[^&#\s]*/giu;

const KEY_VALUE_SECRET_PATTERN =
  /\b((?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|session|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;

const WELL_KNOWN_TOKEN_PATTERN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gu;

const MAX_FIELD_LENGTH = 200;

export function redact(value: string): string {
  const scrubbed = value
    .replace(
      AUTHENTICATED_URL_PATTERN,
      `$1${REDACTED}@`
    )
    .replace(
      SENSITIVE_QUERY_PATTERN,
      `$1${REDACTED}`
    )
    .replace(
      KEY_VALUE_SECRET_PATTERN,
      `$1${REDACTED}`
    )
    .replace(
      WELL_KNOWN_TOKEN_PATTERN,
      REDACTED
    );

  /*
   * Bound the length so an attacker cannot use a huge input to flood or
   * pollute the log stream.
   */
  return scrubbed.length > MAX_FIELD_LENGTH
    ? `${scrubbed.slice(0, MAX_FIELD_LENGTH)}...[truncated]`
    : scrubbed;
}

/*
 * Truncates a client address so events remain correlatable without retaining
 * a full identifier. IPv4 keeps two octets; IPv6 keeps the routing prefix.
 */
export function anonymizeClient(
  value: string
): string {
  if (value === "unknown") {
    return value;
  }

  if (value.includes(":")) {
    const groups = value.split(":");

    return `${groups.slice(0, 2).join(":")}::/32`;
  }

  const octets = value.split(".");

  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.x.x`;
  }

  return "unparsed";
}

export function logSecurityEvent(
  entry: SecurityLogEntry,
  client?: string
): void {
  try {
    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: "security",
      event: entry.event,
      route: entry.route,
      outcome: entry.outcome,
    };

    if (entry.reason) {
      payload.reason = entry.reason;
    }

    if (entry.detail) {
      payload.detail = redact(entry.detail);
    }

    if (entry.finding) {
      payload.finding = entry.finding;
    }

    if (client) {
      payload.client = anonymizeClient(client);
    }

    console.warn(JSON.stringify(payload));
  } catch {
    /*
     * Telemetry must never take down a request path.
     */
  }
}
