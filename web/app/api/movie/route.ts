import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Movie ID required" },
      { status: 400 }
    );
  }

  const res = await fetch(
    `${BASE_URL}/movie/${id}?api_key=${API_KEY}`
  );

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.status_message },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}