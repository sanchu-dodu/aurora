import { NextRequest, NextResponse } from "next/server";
import {
  clientKey,
  rateLimit,
} from "@/app/lib/rateLimit";
import {
  logSecurityEvent,
} from "@/app/lib/securityLog";
import type { TmdbVideo } from "../../types/media";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

const MOVIE_ID_PATTERN = /^[0-9]+$/;

export async function GET(request: NextRequest) {
  /*
   * AEGIS-003: throttle anonymous callers before contacting TMDB so the
   * upstream credential cannot be used as an unmetered proxy.
   */
  const limit = rateLimit(
    `trailer:` + clientKey(request),
    60,
    60_000
  );

  if (!limit.allowed) {
    logSecurityEvent(
      {
        event: "rate_limit_exceeded",
        route: "/api/trailer",
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

  try {
    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Movie ID is required" },
        { status: 400 }
      );
    }

    /*
     * AEGIS-001: reject any non-numeric movie ID before it reaches the
     * upstream URL path. See app/api/movie/route.ts for the full rationale.
     */
    if (!MOVIE_ID_PATTERN.test(id)) {
      logSecurityEvent(
        {
          event: "input_validation_failed",
          route: "/api/trailer",
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
      `${BASE_URL}/movie/${id}/videos`
    );

    url.searchParams.set(
      "api_key",
      API_KEY ?? ""
    );

    const res = await fetch(url);

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.status_message || "Failed to fetch trailer" },
        { status: res.status }
      );
    }

    const trailer = data.results.find(
      (video: TmdbVideo) =>
        video.site === "YouTube" &&
        video.type === "Trailer"
    );

    if (!trailer) {
      return NextResponse.json({});
    }

    return NextResponse.json({
      key: trailer.key,
    });

  } catch (error) {
    logSecurityEvent(
      {
        event: "upstream_failure",
        route: "/api/trailer",
        outcome: "error",
        detail:
          error instanceof Error
            ? error.message
            : "unknown error",
      },
      clientKey(request)
    );

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}