import type { TmdbMovie, TmdbVideo } from "../types/media";

const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

const MOVIE_ID_PATTERN = /^[0-9]+$/;

/*
 * AEGIS-001: movie identifiers flow in from route params and query strings
 * and are interpolated into the upstream URL path. An unvalidated value can
 * traverse to a different TMDB endpoint ("550/../../account") or inject an
 * "api_key" parameter that overrides the server credential. TMDB movie IDs
 * are integers, so a digits-only allowlist is the minimum safe contract.
 */
function assertMovieId(
  id: number | string
): string {
  const value = String(id);

  if (!MOVIE_ID_PATTERN.test(value)) {
    throw new Error("Invalid TMDB movie ID.");
  }

  return value;
}

/*
 * Builds an upstream URL structurally so that neither the path nor the
 * credential can be altered by caller-supplied input.
 */
function buildTmdbUrl(path: string): URL {
  const url = new URL(`${BASE_URL}${path}`);

  url.searchParams.set(
    "api_key",
    API_KEY ?? ""
  );

  return url;
}

async function fetchMovies(endpoint: string): Promise<TmdbMovie[]> {
  const url = buildTmdbUrl(endpoint);

  const res = await fetch(url, {
    next: { revalidate: 3600 },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.status_message || "Failed to fetch movies");
  }

  return data.results || [];
}

export function getTrendingMovies() {
  return fetchMovies("/trending/movie/week");
}

export function getPopularMovies() {
  return fetchMovies("/movie/popular");
}

export function getTopRatedMovies() {
  return fetchMovies("/movie/top_rated");
}

export function getUpcomingMovies() {
  return fetchMovies("/movie/upcoming");
}

export function getNowPlayingMovies() {
  return fetchMovies("/movie/now_playing");
}

export async function getFeaturedMovie() {
  const movies = await getTrendingMovies();

  if (!movies.length) {
    throw new Error("No movies found.");
  }

  return movies[Math.floor(Math.random() * movies.length)];
}

export async function getMovieDetails(id: string) {
  const url = buildTmdbUrl(
    `/movie/${assertMovieId(id)}`
  );

  const res = await fetch(url, {
    next: { revalidate: 3600 },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.status_message || "Failed to fetch movie details"
    );
  }

  return data;
}

export async function getMovieVideos(id: string) {
  const url = buildTmdbUrl(
    `/movie/${assertMovieId(id)}/videos`
  );

  const res = await fetch(url);

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.status_message || "Failed to fetch movie videos"
    );
  }

  return data.results || [];
}

export async function getSimilarMovies(id: string) {
  const url = buildTmdbUrl(
    `/movie/${assertMovieId(id)}/similar`
  );

  const res = await fetch(url);

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.status_message || "Failed to fetch similar movies"
    );
  }

  return data.results || [];
}

export async function searchMovies(query: string) {
  const url = buildTmdbUrl("/search/movie");

  url.searchParams.set("query", query);

  const res = await fetch(url);

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.status_message || "Failed to search movies"
    );
  }

  return data.results || [];
}

export async function getMovieTrailer(id: number | string) {
  const url = buildTmdbUrl(
    `/movie/${assertMovieId(id)}/videos`
  );

  const res = await fetch(url, {
    next: { revalidate: 3600 },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.status_message || "Failed to fetch movie trailer"
    );
  }

  const trailer = data.results.find(
    (video: TmdbVideo) =>
      video.site === "YouTube" &&
      video.type === "Trailer"
  );

  return trailer || null;
}

export async function searchMovieByTitle(title: string) {
  const url = buildTmdbUrl("/search/movie");

  url.searchParams.set("query", title);

  const res = await fetch(url, {
    next: { revalidate: 3600 },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.status_message || "Failed to search movie"
    );
  }

  return data.results?.[0] || null;
}

export async function getFeaturedMovies() {
  const movies = await getTrendingMovies();

  return movies.slice(0, 5);
}