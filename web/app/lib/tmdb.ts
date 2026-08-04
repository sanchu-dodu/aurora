const API_KEY = process.env.TMDB_API_TOKEN;
const BASE_URL = "https://api.themoviedb.org/3";

async function fetchMovies(endpoint: string) {
  const url = `${BASE_URL}${endpoint}?api_key=${API_KEY}`;

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
  const url = `${BASE_URL}/movie/${id}?api_key=${API_KEY}`;

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
  const url = `${BASE_URL}/movie/${id}/videos?api_key=${API_KEY}`;

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
  const url = `${BASE_URL}/movie/${id}/similar?api_key=${API_KEY}`;

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
  const url = `${BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(
    query
  )}`;

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
  const url = `${BASE_URL}/movie/${id}/videos?api_key=${API_KEY}`;

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
    (video: any) =>
      video.site === "YouTube" &&
      video.type === "Trailer"
  );

  return trailer || null;
}

export async function searchMovieByTitle(title: string) {
  const url = `${BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(title)}`;

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