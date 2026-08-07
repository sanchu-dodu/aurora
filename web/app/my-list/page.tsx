"use client";

import Link from "next/link";

import MovieImage from "../components/MovieImage";
import { useUserMyList } from "../lib/useUserMyList";

export default function MyListPage() {
  const {
    movies,
    loading,
    error,
  } = useUserMyList();

  return (
    <main className="min-h-screen bg-[#070B14] text-white px-10 py-16">
      <h1 className="text-5xl font-black mb-12">
        My List
      </h1>

      {loading ? (
        <p
          className="text-gray-400 text-xl"
          aria-live="polite"
        >
          Loading My List...
        </p>
      ) : error ? (
        <p
          role="alert"
          className="text-red-400 text-xl"
        >
          Aurora could not synchronize My List.
        </p>
      ) : movies.length === 0 ? (
        <p className="text-gray-400 text-xl">
          Your list is empty.
        </p>
      ) : (
        <div
          className="
            grid
            grid-cols-2
            md:grid-cols-4
            lg:grid-cols-6
            gap-6
          "
        >
          {movies.map((movie) => (
            <Link
              key={movie.id}
              href={`/movies/${movie.id}`}
              className="group"
            >
              <div className="overflow-hidden rounded-2xl">
                <MovieImage
                  src={
                    movie.poster_path
                      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                      : "/placeholder.svg"
                  }
                  alt={movie.title}
                  className="
                    aspect-[2/3]
                    w-full
                    object-cover
                    transition
                    duration-500
                    group-hover:scale-110
                  "
                />
              </div>

              <h2
                className="
                  mt-3
                  font-bold
                  group-hover:text-blue-400
                  transition
                "
              >
                {movie.title}
              </h2>

              <p className="text-gray-400 text-sm">
                {"\u2B50"} {movie.vote_average?.toFixed(1)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}