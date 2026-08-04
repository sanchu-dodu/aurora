"use client";

import MovieImage from "./MovieImage";

import Link from "next/link";
import type { TmdbMovie } from "../types/media";

type SimilarMoviesProps = {
  movies: TmdbMovie[];
};


export default function SimilarMovies({
  movies,
}: SimilarMoviesProps) {

  return (
    <section className="mt-16">

      <h2 className="text-4xl font-black mb-8">
        More Like This
      </h2>


      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">

        {movies.map((movie) => (

          <Link
            key={movie.id}
            href={`/movies/${movie.id}`}
            className="group"
          >

            <div className="relative overflow-hidden rounded-2xl">


              <MovieImage
                src={
                  movie.poster_path
                    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                    : "/placeholder.svg"
                }
                alt={movie.title}
                className="
                  w-full
                  aspect-[2/3]
                  object-cover
                  transition
                  duration-500
                  group-hover:scale-110
                "
              />


              <div className="
                absolute
                inset-0
                bg-gradient-to-t
                from-black/80
                via-transparent
                opacity-0
                group-hover:opacity-100
                transition
              " />


              <div className="
                absolute
                bottom-3
                left-3
                right-3
                opacity-0
                group-hover:opacity-100
                transition
              ">

                <span className="text-yellow-400 font-bold">
                  ⭐ {movie.vote_average?.toFixed(1)}
                </span>

              </div>


            </div>


            <h3 className="
              mt-3
              font-bold
              truncate
              group-hover:text-blue-400
              transition
            ">
              {movie.title}
            </h3>


            <p className="text-gray-400 text-sm">
              {movie.release_date?.slice(0, 4)}
            </p>


          </Link>

        ))}

      </div>


    </section>
  );
}