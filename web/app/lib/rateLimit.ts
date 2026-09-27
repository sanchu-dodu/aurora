/*
 * AEGIS-003: minimal fixed-window rate limiter.
 *
 * Scope and limitations — read before relying on this:
 *
 *   - State is held in the memory of a single server process. It is NOT
 *     shared across instances, regions, or serverless invocations. On a
 *     horizontally scaled or serverless deployment the effective limit is
 *     (configured limit x number of live instances).
 *   - It is therefore a guard against casual and accidental abuse, not a
 *     defense against a distributed or determined attacker.
 *   - For production, back this with a shared store (Vercel KV, Upstash
 *     Redis, or an edge rate limiter) so the counter is global.
 *
 * It is deliberately dependency-free so it can ship without expanding the
 * supply-chain surface.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowState>();

/*
 * Bounds the map so that a flood of unique keys cannot grow it without limit
 * (the rate limiter must not itself become a memory-exhaustion vector).
 */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, state] of buckets) {
    if (state.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      sweep(now);
    }

    /*
     * If sweeping did not reclaim space every tracked window is still live,
     * so fail closed rather than allowing unbounded growth.
     */
    if (
      buckets.size >= MAX_TRACKED_KEYS &&
      !buckets.has(key)
    ) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(
          windowMs / 1000
        ),
      };
    }

    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });

    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (existing.resetAt - now) / 1000
        )
      ),
    };
  }

  existing.count += 1;

  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/*
 * Derives a best-effort client key. Proxy headers are spoofable, so this is
 * an abuse-mitigation signal only and must never be used for authorization.
 */
export function clientKey(
  request: Request
): string {
  const forwarded = request.headers.get(
    "x-forwarded-for"
  );

  if (forwarded) {
    const first = forwarded
      .split(",")[0]
      .trim();

    if (first) {
      return first;
    }
  }

  return (
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
