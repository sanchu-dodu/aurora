import { NextRequest, NextResponse } from "next/server";
import {
  clientKey,
  rateLimit,
} from "@/app/lib/rateLimit";
import {
  logSecurityEvent,
} from "@/app/lib/securityLog";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

const MOVIE_ID_PATTERN = /^[0-9]+$/;

export async function GET(request: NextRequest) {
  /*
   * AEGIS-003: throttle anonymous callers before contacting TMDB so the
   * upstream credential cannot be used as an unmetered proxy.
   */
  const limit = rateLimit(
    `movie:` + clientKey(request),
    60,
    60_000
  );

  if (!limit.allowed) {
    logSecurityEvent(
      {
        event: "rate_limit_exceeded",
        route: "/api/movie",
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

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Movie ID required" },
      { status: 400 }
    );
  }

  /*
   * AEGIS-001: `id` is interpolated into the upstream URL path. Without a
   * strict allowlist an attacker can traverse to another TMDB endpoint
   * ("550/../../account") or override the credential by injecting a query
   * string ("550?api_key=..."). TMDB movie IDs are integers, so digits-only
   * input is the minimum safe contract.
   */
  if (!MOVIE_ID_PATTERN.test(id)) {
    logSecurityEvent(
      {
        event: "input_validation_failed",
        route: "/api/movie",
        outcome: "blocked",
        reason: "non_numeric_movie_id",
        detail: id,
        finding: "AEGIS-001",
      },
      clientKey(request)
    );

    return NextResponse.json(
      { error: "Movie ID must be numeric" },
      { status: 400 }
    );
  }

  const url = new URL(
    `${BASE_URL}/movie/${id}`
  );

  url.searchParams.set(
    "api_key",
    API_KEY ?? ""
  );

  const res = await fetch(url);

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.status_message },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}