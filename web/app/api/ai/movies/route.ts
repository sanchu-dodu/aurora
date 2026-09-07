import { NextResponse } from "next/server";
import {
  clientKey,
  rateLimit,
} from "@/app/lib/rateLimit";
import {
  logSecurityEvent,
} from "@/app/lib/securityLog";
import { searchMovieByTitle } from "@/app/lib/tmdb";

/*
 * AEGIS-007: app/ai/page.tsx has always called this endpoint, but the route
 * did not exist, so every request returned 404. It is implemented here with
 * the same controls applied to the other routes in this assessment:
 * validated input, bounded work, rate limiting, and security logging.
 */

const MAX_TITLES = 10;

const MAX_TITLE_LENGTH = 200;

const RATE_LIMIT_REQUESTS = 20;

const RATE_LIMIT_WINDOW_MS = 60_000;

interface ResolvedMovie {
  readonly id: number;
  readonly title: string;
  readonly poster_path: string | null;
  readonly vote_average: number;
  readonly release_date?: string;
}

export async function POST(request: Request) {
  /*
   * AEGIS-003: each accepted request fans out into several upstream TMDB
   * lookups, so this route is throttled more tightly than a 1:1 proxy.
   */
  const limit = rateLimit(
    `ai-movies:${clientKey(request)}`,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_MS
  );

  if (!limit.allowed) {
    logSecurityEvent(
      {
        event: "rate_limit_exceeded",
        route: "/api/ai/movies",
        outcome: "blocked",
        finding: "AEGIS-003",
      },
      clientKey(request)
    );

    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            limit.retryAfterSeconds
          ),
        },
      }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    logSecurityEvent(
      {
        event: "malformed_request",
        route: "/api/ai/movies",
        outcome: "blocked",
        reason: "invalid_json",
        finding: "AEGIS-007",
      },
      clientKey(request)
    );

    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const titles =
    typeof body === "object" &&
    body !== null &&
    "titles" in body
      ? (body as { titles: unknown }).titles
      : undefined;

  if (!Array.isArray(titles)) {
    logSecurityEvent(
      {
        event: "input_validation_failed",
        route: "/api/ai/movies",
        outcome: "blocked",
        reason: "titles_not_an_array",
        finding: "AEGIS-007",
      },
      clientKey(request)
    );

    return NextResponse.json(
      { error: "A 'titles' array is required." },
      { status: 400 }
    );
  }

  /*
   * AEGIS-007: bound the fan-out. Without this an attacker could submit a
   * large array and turn one request into unbounded upstream traffic
   * charged against Aurora's TMDB credential.
   */
  if (titles.length > MAX_TITLES) {
    logSecurityEvent(
      {
        event: "input_validation_failed",
        route: "/api/ai/movies",
        outcome: "blocked",
        reason: "too_many_titles",
        finding: "AEGIS-007",
      },
      clientKey(request)
    );

    return NextResponse.json(
      {
        error: `A maximum of ${MAX_TITLES} titles may be requested.`,
      },
      { status: 400 }
    );
  }

  const requested = titles.filter(
    (title): title is string =>
      typeof title === "string" &&
      title.trim().length > 0 &&
      title.length <= MAX_TITLE_LENGTH
  );

  if (requested.length === 0) {
    return NextResponse.json([]);
  }

  try {
    const results = await Promise.all(
      requested.map(title =>
        searchMovieByTitle(title).catch(
          () => null
        )
      )
    );

    /*
     * Returns only the fields the client renders, rather than relaying the
     * full upstream payload.
     */
    const movies: ResolvedMovie[] = [];

    const seen = new Set<number>();

    for (const movie of results) {
      if (
        !movie ||
        typeof movie.id !== "number" ||
        seen.has(movie.id)
      ) {
        continue;
      }

      seen.add(movie.id);

      movies.push({
        id: movie.id,
        title:
          typeof movie.title === "string"
            ? movie.title
            : "Untitled",
        poster_path:
          typeof movie.poster_path === "string"
            ? movie.poster_path
            : null,
        vote_average:
          typeof movie.vote_average === "number"
            ? movie.vote_average
            : 0,
        release_date:
          typeof movie.release_date === "string"
            ? movie.release_date
            : undefined,
      });
    }

    return NextResponse.json(movies);
  } catch (error) {
    logSecurityEvent(
      {
        event: "upstream_failure",
        route: "/api/ai/movies",
        outcome: "error",
        detail:
          error instanceof Error
            ? error.message
            : "unknown error",
      },
      clientKey(request)
    );

    return NextResponse.json(
      { error: "Failed to resolve recommendations." },
      { status: 502 }
    );
  }
}
