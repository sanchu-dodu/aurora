"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Heart, Info, ThumbsUp } from "lucide-react";
import HoverTrailer from "./HoverTrailer";
import HoverInfo from "./HoverInfo";

type MovieCardProps = {
  movie: {
    id: number;
    title: string;
    poster_path: string | null;
    vote_average: number;
    release_date?: string;
  };
};

export default function MovieCard({ movie }: MovieCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group relative min-w-[260px] transition-all duration-300 ease-out hover:-translate-y-6 hover:z-[999]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link href={`/movies/${movie.id}`}>
        <div
          className="
            overflow-hidden
            rounded-2xl
            bg-[#111827]
            shadow-xl
            transition-all
            duration-300
            group-hover:scale-[1.15]
            group-hover:shadow-[0_30px_60px_rgba(0,0,0,0.8)]
          "
        >
          {/* Poster / Trailer */}
          {hovered ? (
            <div className="h-[250px]">
              <HoverTrailer movieId={movie.id} />
            </div>
          ) : (
            <img
              src={
                movie.poster_path
                  ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                  : "/placeholder.jpg"
              }
              alt={movie.title}
              className="h-[360px] w-full object-cover"
            />
          )}

          {/* Expanded Information */}
          {hovered && (
            <div className="bg-[#111827] p-5">

              <div className="flex items-center gap-3">

                <button className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white py-2 font-semibold text-black transition hover:bg-gray-200">
                  <Play size={18} fill="black" />
                  Play
                </button>

                <button className="rounded-full border border-gray-500 p-3 transition hover:border-white hover:bg-white/10">
                  <Heart size={18} />
                </button>

                <button className="rounded-full border border-gray-500 p-3 transition hover:border-white hover:bg-white/10">
                  <ThumbsUp size={18} />
                </button>

                <button className="rounded-full border border-gray-500 p-3 transition hover:border-white hover:bg-white/10">
                  <Info size={18} />
                </button>

              </div>

              <h3 className="mt-5 text-xl font-bold">
                {movie.title}
              </h3>

              <div className="mt-3 flex items-center gap-3 text-sm">
                <span className="font-semibold text-green-500">
                  {Math.round(movie.vote_average * 10)}% Match
                </span>

                <span className="rounded border border-gray-500 px-2 py-0.5">
                  HD
                </span>

                <span>
                  {movie.release_date?.slice(0, 4) || "N/A"}
                </span>
              </div>

              <div className="mt-4">
                <HoverInfo movieId={movie.id} />
              </div>

            </div>
          )}
        </div>
      </Link>
    </div>
  );
}