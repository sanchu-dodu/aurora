"use client";

import { useEffect, useState } from "react";

type HoverInfoProps = {
  movieId: number;
};

type MovieDetails = {
  runtime: number;
  vote_average: number;
  release_date: string;
  genres: {
    id: number;
    name: string;
  }[];
};

export default function HoverInfo({
  movieId,
}: HoverInfoProps) {
  const [movie, setMovie] = useState<MovieDetails | null>(null);

  useEffect(() => {
    async function loadMovie() {
      try {
        const res = await fetch(`/api/movie?id=${movieId}`);
        const data = await res.json();
        setMovie(data);
      } catch (error) {
        console.error(error);
      }
    }

    loadMovie();
  }, [movieId]);

  if (!movie) return null;

  const hours = Math.floor(movie.runtime / 60);
  const minutes = movie.runtime % 60;

  return (
    <div className="bg-[#111827] p-5">

      <div className="mb-4 flex items-center justify-between">

        <span className="rounded-full bg-green-600 px-3 py-1 text-sm font-semibold">
          ⭐ {movie.vote_average.toFixed(1)}
        </span>

        <span className="text-gray-400">
          {movie.release_date?.slice(0, 4)}
        </span>

        <span className="text-gray-400">
          {hours}h {minutes}m
        </span>

      </div>

      <div className="flex flex-wrap gap-2">

        {movie.genres.slice(0, 3).map((genre) => (
          <span
            key={genre.id}
            className="rounded-full bg-blue-600/20 px-3 py-1 text-sm text-blue-300"
          >
            {genre.name}
          </span>
        ))}

      </div>

    </div>
  );
}