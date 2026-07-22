"use client";

import { useState } from "react";
import Link from "next/link";

type Movie = {
  id: number;
  title: string;
  poster_path: string | null;
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);

  // NEW: Track whether the user has actually searched
  const [searched, setSearched] = useState(false);

 async function handleSearch() {
  if (!query.trim()) return;

  setLoading(true);
  setSearched(true);

  try {
    const response = await fetch(
      `/api/search?query=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const data = await response.json();

    setMovies(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("Search failed:", error);
    setMovies([]);
  } finally {
    setLoading(false);
  }
}
  return (
    <main className="min-h-screen bg-[#070B14] text-white px-8 py-12">
      <h1 className="mb-10 text-5xl font-black">
        Search Aurora
      </h1>

      <div className="mb-10 flex gap-4">
        <input
          type="text"
          value={query}
          placeholder="Search movies..."
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
          className="flex-1 rounded-xl bg-[#1f2937] px-6 py-4 outline-none"
        />

        <button
          onClick={handleSearch}
          className="rounded-xl bg-blue-600 px-8 py-4 transition hover:bg-blue-700"
        >
          Search
        </button>
      </div>

      {loading && (
        <p className="mb-6 text-gray-400">
          Searching...
        </p>
      )}

      {!loading && searched && movies.length === 0 && (
        <p className="mb-6 text-gray-400">
          No movies found.
        </p>
      )}

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4 lg:grid-cols-6">
        {movies.map((movie) => (
          <Link
            key={movie.id}
            href={`/movies/${movie.id}`}
            className="group"
          >
            <img
              src={
                movie.poster_path
                  ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                  : "/placeholder.jpg"
              }
              alt={movie.title}
              className="aspect-[2/3] w-full rounded-xl object-cover transition duration-300 group-hover:scale-105"
            />

            <h2 className="mt-3 text-center font-bold">
              {movie.title}
            </h2>
          </Link>
        ))}
      </div>
    </main>
  );
}