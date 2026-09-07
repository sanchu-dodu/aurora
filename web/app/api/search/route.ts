import { NextResponse } from "next/server";
import {
  clientKey,
  rateLimit,
} from "@/app/lib/rateLimit";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

export async function GET(request: Request) {
  /*
   * AEGIS-003: throttle anonymous callers before contacting TMDB so the
   * upstream credential cannot be used as an unmetered proxy.
   */
  const limit = rateLimit(
    `search:` + clientKey(request),
    30,
    60_000
  );

  if (!limit.allowed) {
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

  const { searchParams } = new URL(request.url);

  const query = searchParams.get("query");

  if (!query) {
    return NextResponse.json([]);
  }

  /*
   * AEGIS-001 (defense in depth): build the upstream URL structurally so the
   * user-supplied query can never introduce additional parameters or
   * override the server credential.
   */
  const url = new URL(
    `${BASE_URL}/search/movie`
  );

  url.searchParams.set(
    "api_key",
    API_KEY ?? ""
  );

  url.searchParams.set(
    "query",
    query
  );

  const res = await fetch(url);

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.status_message },
      { status: res.status }
    );
  }

  return NextResponse.json(data.results);
}