import { NextResponse } from "next/server";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const query = searchParams.get("query");

  if (!query) {
    return NextResponse.json([]);
  }

  const res = await fetch(
    `${BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(query)}`
  );

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.status_message },
      { status: res.status }
    );
  }

  return NextResponse.json(data.results);
}