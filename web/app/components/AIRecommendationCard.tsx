"use client";

import MovieImage from "./MovieImage";

import Link from "next/link";
import { Star, Play } from "lucide-react";

type Props = {
  movie: {
    id: number;
    title: string;
    poster_path: string | null;
    vote_average: number;
    release_date?: string;
  };
};

export default function AIRecommendationCard({ movie }: Props) {
  return (
    <Link href={`/movies/${movie.id}`}>
      <div
        className="
          group
          overflow-hidden
          rounded-3xl
          bg-[#111827]
          transition
          duration-300
          hover:-translate-y-2
          hover:shadow-2xl
          hover:shadow-blue-500/30
        "
      >
        <MovieImage
          src={
            movie.poster_path
              ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
              : "/placeholder.svg"
          }
          alt={movie.title}
          className="
            h-[330px]
            w-full
            object-cover
            transition
            duration-500
            group-hover:scale-105
          "
        />

        <div className="space-y-3 p-5">
          <h2 className="line-clamp-1 text-xl font-bold">
            {movie.title}
          </h2>

          <div className="flex items-center justify-between text-gray-400">
            <span className="flex items-center gap-2">
              <Star size={16} className="text-yellow-400 fill-yellow-400" />
              {movie.vote_average.toFixed(1)}
            </span>

            <span>
              {movie.release_date?.slice(0, 4)}
            </span>
          </div>

          <button
            className="
              mt-2
              flex
              w-full
              items-center
              justify-center
              gap-2
              rounded-xl
              bg-blue-600
              py-3
              font-semibold
              transition
              hover:bg-blue-500
            "
          >
            <Play size={18} fill="white" />
            View Movie
          </button>
        </div>
      </div>
    </Link>
  );
}