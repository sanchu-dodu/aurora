"use client";

import Image from "next/image";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Play, Info } from "lucide-react";
import HeroTrailer from "./HeroTrailer";
import type { TmdbMovie } from "../types/media";

export default function HeroCarousel({
  movies,
}: {
  movies: TmdbMovie[];
}) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % movies.length);
    }, 25000);

    return () => clearInterval(timer);
  }, [movies.length]);

  const movie = movies[current];

  return (
    <>
      {/* Background */}
      <Image
        key={movie.id}
        src={
          movie.backdrop_path
            ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
            : "/placeholder.svg"
        }
        alt={movie.title}
        fill
        sizes="100vw"
        loading="eager"
        fetchPriority="high"
        className="object-cover"
      />

      <HeroTrailer movieId={movie.id} />

      {/* Overlays */}
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#070B14] via-[#070B14]/80 to-transparent" />

      {/* Content */}
      <div className="relative z-20 flex h-full items-center">

        <div className="w-full max-w-4xl px-6 sm:px-10 lg:px-16 xl:px-24 animate-fadeIn">

          <p className="mb-3 text-xs uppercase tracking-[0.4rem] text-blue-400 sm:text-sm lg:text-base">
            Featured Movie
          </p>

          <h1 className="
            font-black
            leading-tight
            text-4xl
            sm:text-5xl
            md:text-6xl
            lg:text-7xl
            xl:text-8xl
          ">
            {movie.title}
          </h1>

          <div className="mt-5 flex flex-wrap gap-5 text-gray-300 text-sm sm:text-base lg:text-lg">
            <span>⭐ {movie.vote_average.toFixed(1)}</span>
            <span>{movie.release_date.slice(0, 4)}</span>
          </div>

          <p className="
            mt-6
            max-w-2xl
            text-sm
            leading-7
            text-gray-300
            sm:text-base
            sm:leading-8
            lg:text-xl
            lg:leading-9
          ">
            {movie.overview}
          </p>

          <div className="mt-8 flex flex-wrap gap-4">

            <Link
              href={`/movies/${movie.id}`}
              className="
                flex
                items-center
                gap-2
                rounded-xl
                bg-blue-600
                px-6
                py-3
                font-semibold
                transition
                hover:bg-blue-700
                sm:px-8
                sm:py-4
              "
            >
              <Play size={20} />
              Watch Now
            </Link>

            <Link
              href={`/movies/${movie.id}`}
              className="
                flex
                items-center
                gap-2
                rounded-xl
                border
                border-white
                px-6
                py-3
                transition
                hover:bg-white
                hover:text-black
                sm:px-8
                sm:py-4
              "
            >
              <Info size={20} />
              More Info
            </Link>

          </div>

          {/* Navigation Dots */}
          <div className="mt-10 flex gap-3">
            {movies.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrent(index)}
                className={`h-3 rounded-full transition-all ${
                  index === current
                    ? "w-10 bg-blue-500"
                    : "w-3 bg-white/50"
                }`}
              />
            ))}
          </div>

        </div>

      </div>
    </>
  );
}