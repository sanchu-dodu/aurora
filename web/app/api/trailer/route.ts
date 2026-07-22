import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Movie ID is required" },
        { status: 400 }
      );
    }

    const res = await fetch(
      `${BASE_URL}/movie/${id}/videos?api_key=${API_KEY}`
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.status_message || "Failed to fetch trailer" },
        { status: res.status }
      );
    }

    const trailer = data.results.find(
      (video: any) =>
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
    console.error(error);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}