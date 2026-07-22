"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Play, Info } from "lucide-react";

type ContinueMovie = {
  id: number;
  title: string;
  poster: string;
  progress: number;
  duration: number;
};

export default function ContinueWatching() {
  const [movies, setMovies] = useState<ContinueMovie[]>([]);

  useEffect(() => {
    const saved = JSON.parse(
      localStorage.getItem("aurora-progress") || "[]"
    );

    setMovies(saved);
  }, []);

  if (movies.length === 0) return null;

  return (
    <section className="my-16 px-8">
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-3xl font-black">
          Continue Watching
        </h2>

        <span className="text-sm text-gray-400">
          {movies.length} {movies.length === 1 ? "movie" : "movies"}
        </span>
      </div>

      <div className="flex gap-8 overflow-x-auto pb-6 scrollbar-hide">
        {movies.map((movie) => {
          const percentage =
            movie.duration > 0
              ? (movie.progress / movie.duration) * 100
              : 0;

          return (
            <div
              key={movie.id}
              className="
                group
                min-w-[300px]
                overflow-hidden
                rounded-3xl
                bg-[#111827]
                transition-all
                duration-300
                hover:-translate-y-3
                hover:shadow-2xl
                hover:shadow-blue-600/30
              "
            >
              <Link href={`/movies/${movie.id}`}>
                <img
                  src={movie.poster}
                  alt={movie.title}
                  className="
                    h-[420px]
                    w-full
                    object-cover
                    transition
                    duration-500
                    group-hover:scale-105
                  "
                />
              </Link>

              <div className="p-5">

                <h3 className="truncate text-xl font-bold">
                  {movie.title}
                </h3>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{
                      width: `${percentage}%`,
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    {Math.floor(percentage)}% watched
                  </span>

                  <span className="text-sm text-blue-400">
                    Resume
                  </span>
                </div>

                <div className="mt-6 flex gap-3">

                  <Link
                    href={`/movies/${movie.id}`}
                    className="
                      flex
                      flex-1
                      items-center
                      justify-center
                      gap-2
                      rounded-full
                      bg-white
                      py-3
                      font-semibold
                      text-black
                      transition
                      hover:bg-gray-200
                    "
                  >
                    <Play size={18} fill="black" />
                    Resume
                  </Link>

                  <Link
                    href={`/movies/${movie.id}`}
                    className="
                      flex
                      h-12
                      w-12
                      items-center
                      justify-center
                      rounded-full
                      border
                      border-gray-500
                      transition
                      hover:border-white
                      hover:bg-white/10
                    "
                  >
                    <Info size={20} />
                  </Link>

                </div>

              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}